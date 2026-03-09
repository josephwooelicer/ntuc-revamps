import { chromium } from 'playwright';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';


/**
 * DataGovSgConnector is responsible for scraping and downloading datasets from data.gov.sg.
 * It uses Playwright to navigate the site, perform searches based on agency and date range filters,
 * and intercept raw dataset file downloads (e.g., CSV, XLSX, PDF).
 */
export class DataGovSgConnector implements Connector {
    id = 'src-data-gov-sg';

    /**
     * Executes the pull operation for data.gov.sg.
     * 
     * @param range Optional date range to filter datasets by.
     * @param cursor Pagination cursor (currently not used by this connector).
     * @param options Additional options like 'agency', 'month', 'year'.
     * @returns A promise resolving to the IngestionResult containing downloaded documents.
     */
    async pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        console.log(`[DataGovSgConnector] Pulling data.gov.sg with options: ${JSON.stringify(options)}`);

        const agency = options?.agency || 'MOM';
        const formats = encodeURIComponent('CSV|XLSX|PDF');
        const baseUrl = `https://data.gov.sg/datasets?agencies=${agency}&formats=${formats}`;

        const documents: RawDocument[] = [];
        const browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        try {
            const context = await browser.newContext();
            const page = await context.newPage();

            console.log(`[DataGovSgConnector] Navigating to: ${baseUrl}`);
            try {
                await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
            } catch (err: any) {
                console.warn(`[DataGovSgConnector] Warning: Initial navigation failed (${err.message}). Retrying...`);
                await page.goto('https://data.gov.sg/datasets', { waitUntil: 'load', timeout: 60000 });
            }
            // Wait for JS to hydrate the React SPA
            await page.waitForTimeout(5000);

            // 1. Click "Load more" until exhaustion
            let hasMore = true;
            let loopCount = 0;
            while (hasMore && loopCount < 100) {
                loopCount++;
                try {
                    const loadMoreBtn = page.locator('button', { hasText: /Load more/i });
                    if (await loadMoreBtn.isVisible()) {
                        console.log(`[DataGovSgConnector] Clicking Load more (page ${loopCount})...`);
                        await loadMoreBtn.click();
                        await page.waitForTimeout(2000);
                    } else {
                        hasMore = false;
                    }
                } catch (e) {
                    hasMore = false;
                }
            }

            // 2. Get the list of datasets
            // Datasets are links with resultId in the sidebar
            const datasetLinks = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="resultId=d_"]'));
                return links.map(a => (a as HTMLAnchorElement).href);
            });

            const uniqueLinks = Array.from(new Set(datasetLinks));
            console.log(`[DataGovSgConnector] Found ${uniqueLinks.length} unique datasets.`);

            for (const link of uniqueLinks) {
                const urlObj = new URL(link);
                const resultId = urlObj.searchParams.get('resultId') || '';
                if (!resultId) continue;

                console.log(`[DataGovSgConnector] Processing dataset: ${resultId}`);

                try {
                    const datasetPage = await context.newPage();
                    // Navigate to the resultId URL which shows the dataset side panel
                    await datasetPage.goto(link, { waitUntil: 'load', timeout: 60000 });
                    await datasetPage.waitForTimeout(4000);

                    // Get "Last Updated" date from JSON-LD schema metadata embedded in the page
                    const lastUpdatedText: string = await datasetPage.evaluate(() => {
                        // First try JSON-LD schema metadata (most reliable)
                        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                        for (const script of scripts) {
                            try {
                                const json = JSON.parse((script as HTMLScriptElement).innerText || script.textContent || '');
                                const modified = json['schema:dateModified'] || json['dateModified'];
                                if (modified) return modified;
                            } catch (e) { }
                        }
                        // Fallback: look for text nodes with date-like content near 'updated'
                        const walker = (document as any).createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                        let node;
                        while (node = walker.nextNode()) {
                            const t: string = node.nodeValue?.trim() || '';
                            if (t.toLowerCase().includes('last updated') || t.toLowerCase().includes('datemodified')) return t;
                        }
                        return '';
                    }).catch(() => '');

                    let docDate = 'unknown-date';
                    if (lastUpdatedText) {
                        // Handle ISO date format (from JSON-LD)
                        const isoDate = new Date(lastUpdatedText);
                        if (!isNaN(isoDate.getTime())) {
                            docDate = isoDate.toISOString().split('T')[0];
                        } else {
                            // Try natural language date format
                            const dateMatch = lastUpdatedText.match(/(\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i);
                            if (dateMatch) {
                                const dateObj = new Date(dateMatch[1]);
                                if (!isNaN(dateObj.getTime())) {
                                    docDate = dateObj.toISOString().split('T')[0];
                                }
                            }
                        }
                    }

                    const datasetTitle = await datasetPage.locator('h1').first().innerText().catch(() => resultId);

                    // Find all possible download buttons (e.g. "Download XLSX", "Download CSV", "Download PDF")
                    const downloadElements = datasetPage.locator('button:has-text("Download")');
                    const downloadCount = await downloadElements.count();
                    console.log(`[DataGovSgConnector] Found ${downloadCount} download button(s) for ${resultId}`);

                    if (downloadCount > 0) {
                        for (let i = 0; i < downloadCount; i++) {
                            try {
                                const el = downloadElements.nth(i);
                                const downloadPromise = datasetPage.waitForEvent('download', { timeout: 10000 }).catch(() => null);
                                await el.click({ force: true });
                                const download = await downloadPromise;

                                if (download) {
                                    const downloadPath = await download.path();
                                    if (downloadPath) {
                                        const content = await fs.promises.readFile(downloadPath);
                                        const filename = download.suggestedFilename();

                                        const ext = path.extname(filename).toUpperCase().replace('.', '');
                                        if (!['CSV', 'XLSX', 'PDF'].includes(ext)) {
                                            console.log(`[DataGovSgConnector] Skipping file ${filename} (unsupported format: ${ext})`);
                                            continue;
                                        }

                                        const metadata: Record<string, any> = {
                                            agency,
                                            datasetId: resultId,
                                            date: docDate,
                                            filename,
                                            customDir: path.join(agency, docDate)
                                        };

                                        const docId = crypto.createHash('sha256').update(this.id + resultId + filename).digest('hex');
                                        const doc: RawDocument = {
                                            id: docId,
                                            sourceId: this.id,
                                            externalId: resultId,
                                            fetchedAt: new Date().toISOString(),
                                            publishedAt: docDate !== 'unknown-date' ? new Date(docDate).toISOString() : new Date().toISOString(),
                                            title: `${datasetTitle} - ${filename}`,
                                            url: link,
                                            content: content,
                                            metadata: metadata
                                        };

                                        if (onDocument) {
                                            await onDocument(doc);
                                        }
                                        documents.push(doc);
                                        console.log(`[DataGovSgConnector] Downloaded ${filename} from dataset ${resultId}`);
                                    }
                                }
                            } catch (e) {
                                // Ignore individual download failures
                            }
                        }
                    }

                    await datasetPage.close();
                } catch (err: any) {
                    console.error(`[DataGovSgConnector] Error processing dataset ${link}: ${err.message}`);
                }
            }

        } catch (err: any) {
            console.error(`[DataGovSgConnector] Connector error: ${err.message}`);
        } finally {
            await browser.close();
        }

        return {
            documents,
            cursor: undefined
        };
    }
}
