import { chromium } from 'playwright';
import * as crypto from 'crypto';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';

/**
 * LayoffsFyiConnector retrieves layoff records from the layoffs.fyi Airtable tracker,
 * filtered to Singapore companies only.
 *
 * Data source:
 *   https://airtable.com/app1PaujS9zxVGUZ4/shroKsHx3SdYYOzeh/tblleV7Pnb6AcPCYL?viewControls=on
 *
 * Airtable DOM structure (confirmed via debug):
 *   - The grid is virtualised; rows use [data-testid="data-row"] and [data-rowid="recXXX"].
 *   - The grid is split into two parallel scroll panes:
 *       • leftPane  – frozen column(s), e.g. Company
 *       • rightPane – scrollable columns: Location HQ, # Laid Off, Date, %, Industry, Source, Stage, $ Raised
 *   - Both panes share the same data-rowid, so rows can be joined by rowid.
 *   - Cell text is in elements matching [class*="cell"].
 *
 * Known column order (Airtable may add or reorder columns; we use a hardcoded fallback):
 *   Left pane:  [0] row-number, [1] Company
 *   Right pane: [0] Location HQ, [1] # Laid Off, [2] Date, [3] %, [4] Industry,
 *               [5] Source, [6] Stage, [7] $ Raised (M)
 *
 * Strategy:
 *   1. Open the Airtable shared-view URL.
 *   2. Wait for data-testid="data-row" to appear.
 *   3. Apply the Airtable Filter UI (Country/Location = Singapore) when available;
 *      fall back to in-memory post-filtering.
 *   4. Scroll through the virtualised grid, joining left + right pane cells by rowid.
 *   5. Package each Singapore row as a RawDocument.
 */
export class LayoffsFyiConnector implements Connector {
    id = 'src-layoffs-fyi';

    private readonly AIRTABLE_URL =
        'https://airtable.com/app1PaujS9zxVGUZ4/shroKsHx3SdYYOzeh/tblleV7Pnb6AcPCYL?viewControls=on';

    // Fallback column order when Airtable headers cannot be read from the DOM
    private readonly LEFT_COLS = ['rowNumber', 'company'];
    private readonly RIGHT_COLS = ['location', 'numLayoffs', 'date', 'percentage', 'industry', 'source', 'stage', 'fundsRaised'];

    async pull(range?: IngestionRange, cursor?: string, options?: Record<string, any>): Promise<IngestionResult> {
        const country: string = options?.country ?? 'Singapore';
        console.log(`[LayoffsFyiConnector] Pulling records for country="${country}"...`);

        const documents: RawDocument[] = [];
        const browser = await chromium.launch({ headless: false });

        try {
            const context = await browser.newContext({
                viewport: { width: 1600, height: 900 },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            const page = await context.newPage();

            // ── 1. Navigate ─────────────────────────────────────────────────────
            console.log(`[LayoffsFyiConnector] Navigating to ${this.AIRTABLE_URL}`);
            await page.goto(this.AIRTABLE_URL, { waitUntil: 'load', timeout: 90000 });

            console.log('[LayoffsFyiConnector] Waiting for grid to render...');
            try {
                await page.waitForSelector('[data-testid="data-row"]', { timeout: 30000 });
                console.log('[LayoffsFyiConnector] Grid rendered. Stabilising...');
                await page.waitForTimeout(2000);
            } catch {
                console.log('[LayoffsFyiConnector] waitForSelector timed out – using 15s fallback.');
                await page.waitForTimeout(15000);
            }

            // ── 2. Apply Filter UI (best-effort) ────────────────────────────────
            const filtered = await this.applyCountryFilter(page, country);
            if (filtered) {
                await page.waitForTimeout(4000);
            }

            // ── 3. Scroll and collect all rows ──────────────────────────────────
            const rows = await this.scrollAndCollectRows(page, country, filtered);
            console.log(`[LayoffsFyiConnector] Collected ${rows.length} row(s) for "${country}".`);

            // ── 4. Build Consolidated RawDocument (CSV) ─────────────────────────
            if (rows.length > 0) {
                const csvContent = this.convertToCsv(rows);
                const runId = `run_${Date.now()}`;
                const stableKey = `${this.id}|${country}|${runId}`;
                const docId = crypto.createHash('sha256').update(stableKey).digest('hex');

                documents.push({
                    id: docId,
                    sourceId: this.id,
                    externalId: `csv_${Date.now()}`,
                    fetchedAt: new Date().toISOString(),
                    publishedAt: new Date().toISOString(),
                    title: `Layoffs.fyi ${country} Consolidated Data`,
                    url: this.AIRTABLE_URL,
                    content: csvContent,
                    metadata: {
                        isSingleton: true,
                        filename: 'data.csv',
                        country,
                        recordCount: rows.length
                    }
                });
            }

        } catch (err: any) {
            console.error(`[LayoffsFyiConnector] Error: ${err.message}`);
            throw err;
        } finally {
            await browser.close();
        }

        return { documents, cursor: undefined };
    }

    // ── Private helpers ──────────────────────────────────────────────────────────

    private convertToCsv(rows: LayoffRecord[]): string {
        if (rows.length === 0) return '';
        const headers = ['Company', 'Location HQ', '# Laid Off', 'Date', '%', 'Industry', 'Source', 'Stage', '$ Raised (M)'];
        const csvRows = [headers.join(',')];

        for (const row of rows) {
            const values = [
                row.company,
                row.location,
                row.numLayoffs,
                row.date,
                row.percentage,
                row.industry,
                row.source,
                row.stage,
                row.fundsRaised
            ].map(v => {
                const s = String(v || '').replace(/"/g, '""');
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
            });
            csvRows.push(values.join(','));
        }
        return csvRows.join('\n');
    }

    private async applyCountryFilter(page: import('playwright').Page, country: string): Promise<boolean> {
        try {
            // 1. Open Filter Menu
            console.log('[LayoffsFyiConnector] Attempting to open filter menu...');
            const filterBtn = page.locator('div[aria-label="Filter rows"]').first();
            if (!await filterBtn.isVisible({ timeout: 10000 })) {
                console.log('[LayoffsFyiConnector] Filter toolbar button not visible – falling back to post-filtering.');
                return false;
            }
            await filterBtn.click();
            await page.waitForTimeout(1500);

            // 2. Add Condition (if no filter is active, look for 'Add condition' button)
            console.log('[LayoffsFyiConnector] Checking for "Add condition" button...');
            const addBtn = page.locator('div[aria-label="Add condition"]').first();
            if (await addBtn.isVisible({ timeout: 4000 })) {
                await addBtn.click();
                await page.waitForTimeout(1500);
            }

            // 3. Select 'Country' field
            console.log('[LayoffsFyiConnector] Selecting "Country" field...');
            const fieldDropdown = page.locator('div[role="dialog"] div[role="button"]').first();
            if (await fieldDropdown.isVisible({ timeout: 5000 })) {
                await fieldDropdown.click();
                await page.waitForTimeout(1000);

                // Type "Country" in the search box
                const searchInput = page.locator('input[aria-label="Find a field"]');
                if (await searchInput.isVisible({ timeout: 3000 })) {
                    await searchInput.fill('Country');
                    await page.waitForTimeout(1000);

                    // Click the specific "Country" option in the list
                    const option = page.locator('[role="listbox"] [role="option"]:has-text("Country")').first();
                    if (await option.isVisible({ timeout: 3000 })) {
                        await option.click();
                    } else {
                        await page.keyboard.press('Enter');
                    }
                    await page.waitForTimeout(1500);
                }
            }

            // 4. Enter the filter value
            console.log(`[LayoffsFyiConnector] Entering value "${country}"...`);

            // Try different value input modes
            const valInput = page.locator('input[aria-label="Filter comparison value"]').first();
            const valDropdown = page.locator('div[role="dialog"] [role="button"]:has-text("Select an option"), div[role="dialog"] [role="button"]:has-text("empty")').first();

            if (await valInput.isVisible({ timeout: 4000 })) {
                console.log('[LayoffsFyiConnector] Mode: Text Input');
                await valInput.click();
                await valInput.fill(country);
                await page.waitForTimeout(800);
                await page.keyboard.press('Enter');
            } else if (await valDropdown.isVisible({ timeout: 4000 })) {
                console.log('[LayoffsFyiConnector] Mode: Dropdown Selection');
                await valDropdown.click();
                await page.waitForTimeout(1000);
                await page.keyboard.type(country);
                await page.waitForTimeout(1000);
                await page.keyboard.press('Enter');
            } else {
                console.log('[LayoffsFyiConnector] Neither text input nor dropdown button found for value entry.');
                // Fallback: try to just type and see if it works
                await page.keyboard.press('Tab');
                await page.keyboard.type(country);
                await page.keyboard.press('Enter');
            }



            await page.waitForTimeout(1000);
            await page.keyboard.press('Escape');
            console.log('[LayoffsFyiConnector] Filter applied. Waiting 5s for grid to refresh...');
            await page.waitForTimeout(5000);

            return true;
        } catch (err: any) {
            console.warn(`[LayoffsFyiConnector] Failed to apply UI filter: ${err.message}. Post-filtering will still run.`);
            try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
            return false;
        }
    }

    /**
     * Scrolls the Airtable grid and collects all rows by joining left-pane and
     * right-pane cells using the shared data-rowid attribute.
     */
    private async scrollAndCollectRows(
        page: import('playwright').Page,
        country: string,
        filtered: boolean
    ): Promise<LayoffRecord[]> {
        const recordsSeen = new Set<string>(); // for dedup of Singapore records
        const rowIdsSeen = new Set<string>(); // for scroll stabilisation
        const records: LayoffRecord[] = [];

        // leftPane cells:  [0]=rowNumber, [1]=company
        // rightPane cells: [0]=location, [1]=numLayoffs, [2]=date, [3]=pct,
        //                  [4]=industry, [5]=source, [6]=stage, [7]=fundsRaised

        let stableRounds = 0; // rounds with no new unique rowIds
        let scrollStep = 0;
        const MAX_STEPS = 300;

        while (stableRounds < 3 && scrollStep < MAX_STEPS) {
            scrollStep++;

            // === Extract currently rendered rows using data-columnid for reliable column mapping ===
            const rawRows: Array<{ rowId: string; isLeft: boolean; colMap: Record<string, string>; companyText: string }> =
                await page.evaluate(() => {
                    const out: Array<{ rowId: string; isLeft: boolean; colMap: Record<string, string>; companyText: string }> = [];
                    document.querySelectorAll('div[data-rowid]').forEach(row => {
                        const rowId = row.getAttribute('data-rowid') || '';
                        if (!rowId) return;
                        const isLeft = (row as HTMLElement).classList.contains('leftPane');

                        if (isLeft) {
                            // Left pane: extract company name (only non-number cell text)
                            let companyText = '';
                            (row as HTMLElement).querySelectorAll('[class*="cell"]').forEach(c => {
                                const t = ((c as HTMLElement).innerText || '').trim();
                                if (t && !/^\d+$/.test(t)) companyText = t;
                            });
                            out.push({ rowId, isLeft: true, colMap: {}, companyText });
                        } else {
                            // Right pane: build colId -> cell text map
                            const colMap: Record<string, string> = {};
                            (row as HTMLElement).querySelectorAll('[data-columnid]').forEach(c => {
                                const colId = c.getAttribute('data-columnid') || '';
                                if (colId) colMap[colId] = ((c as HTMLElement).innerText || '').trim();
                            });
                            out.push({ rowId, isLeft: false, colMap, companyText: '' });
                        }
                    });
                    return out;
                });

            // Count new unique rowIds in this batch
            let newRowIds = 0;
            for (const r of rawRows) {
                if (!rowIdsSeen.has(r.rowId)) {
                    rowIdsSeen.add(r.rowId);
                    newRowIds++;
                }
            }

            if (newRowIds === 0) {
                stableRounds++;
            } else {
                stableRounds = 0;
            }

            console.log(`[LayoffsFyiConnector] Step ${scrollStep}: rendered=${rawRows.length}, uniqueTotal=${rowIdsSeen.size}, newThisStep=${newRowIds}, stable=${stableRounds}`);

            // === Merge left + right pane data by rowId in Node.js ===
            const byId: Record<string, { company: string; colMap: Record<string, string> }> = {};
            for (const r of rawRows) {
                if (!byId[r.rowId]) byId[r.rowId] = { company: '', colMap: {} };
                if (r.isLeft) {
                    byId[r.rowId].company = r.companyText;
                } else {
                    Object.assign(byId[r.rowId].colMap, r.colMap);
                }
            }

            // Column IDs from debug:
            // location: fldeoYEol1GhizODE, numLayoffs: fldH1FcSF7DAaS1EB, date: fldaRiRVH3vaD9DRC, country: fldATTnRRO0iX7jr0
            const COL_IDS = {
                location: 'fldeoYEol1GhizODE',
                numLayoffs: 'fldH1FcSF7DAaS1EB',
                date: 'fldaRiRVH3vaD9DRC',
                percentage: 'fldZRD6CwpFopYqqv',
                industry: 'fldZxgn3xoVqoHWuj',
                source: 'fldpt9Gt8PewUC1Sh',
                stage: 'fldoYp88YU5yEaK2P',
                fundsRaised: 'fldiT8WOrVKce4LDj',
                country: 'fldATTnRRO0iX7jr0'
            };

            for (const [rowId, data] of Object.entries(byId)) {
                const company = data.company;
                const countryVal = data.colMap[COL_IDS.country] || '';
                const locationHQ = data.colMap[COL_IDS.location] || '';
                const date = data.colMap[COL_IDS.date] || '';

                if (!company) continue;

                // ALWAYS post-filter as a safety check, even if UI filter was applied.
                // This ensures we only ingest relevant records and handles potential UI filter drift.
                const isMatch = countryVal.toLowerCase().includes(country.toLowerCase()) ||
                    locationHQ.toLowerCase().includes(country.toLowerCase());

                if (!isMatch) continue;

                const key = `${company}|${locationHQ}|${date}`;
                if (recordsSeen.has(key)) continue;
                recordsSeen.add(key);

                records.push({
                    company,
                    location: locationHQ,
                    numLayoffs: data.colMap[COL_IDS.numLayoffs] || '',
                    date,
                    percentage: data.colMap[COL_IDS.percentage] || '',
                    industry: data.colMap[COL_IDS.industry] || '',
                    source: data.colMap[COL_IDS.source] || '',
                    stage: data.colMap[COL_IDS.stage] || '',
                    fundsRaised: data.colMap[COL_IDS.fundsRaised] || ''
                });
                console.log(`[LayoffsFyiConnector] Found Singapore record: ${company} (${date})`);
            }

            // Scroll the Airtable virtual grid
            await page.evaluate(() => {
                const container =
                    document.querySelector('.antiscroll-inner') ||
                    document.querySelector('.ReactVirtualized__Grid') ||
                    document.querySelector('[class*="rightPane"]') ||
                    document.body;
                if (container) {
                    container.scrollTop += 3000;
                }
            });
            await page.waitForTimeout(1000); // Wait for new virtual rows to load
        }

        console.log(`[LayoffsFyiConnector] Scroll done: ${scrollStep} steps, ${rowIdsSeen.size} unique rowIds, ${records.length} Singapore records.`);
        return records;
    }
}

interface LayoffRecord {
    company: string;
    location: string;
    numLayoffs: string;
    date: string;
    percentage: string;
    industry: string;
    source: string;
    stage: string;
    fundsRaised: string;
}
