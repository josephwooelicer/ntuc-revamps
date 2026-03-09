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
        console.log(`[DataGovSgConnector] Pulling data.gov.sg for options: ${JSON.stringify(options)}`);

        // If options contain month/year/agency
        let agency = options?.agency || 'MOM'; // Default
        let startUnix = '';
        let endUnix = '';

        if (options?.month && options?.year) {
            // "FEB", "2026"
            // Get start of month and end of month
            const year = parseInt(options.year, 10);
            const monthMap: Record<string, string> = {
                'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
                'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
            };
            const mStr = monthMap[options.month.toUpperCase()];
            if (mStr) {
                const m = parseInt(mStr, 10) - 1;
                const startDate = new Date(Date.UTC(year, m, 1));
                const endDate = new Date(Date.UTC(year, m + 1, 0, 23, 59, 59));
                startUnix = Math.floor(startDate.getTime() / 1000).toString();
                endUnix = Math.floor(endDate.getTime() / 1000).toString();
            }
        } else if (range) {
            // Adjust for 8 hour offset (SGT is UTC+8)
            const OFFSET_SECONDS = 8 * 3600;
            startUnix = (Math.floor(range.start.getTime() / 1000) - OFFSET_SECONDS).toString();
            endUnix = (Math.floor(range.end.getTime() / 1000) - OFFSET_SECONDS).toString();
        }

        const formats = encodeURIComponent('CSV|XLSX|PDF');
        let baseUrl = `https://data.gov.sg/datasets?agencies=${agency}&formats=${formats}`;
        if (startUnix && endUnix) {
            baseUrl += `&coverage=${startUnix}%7C${endUnix}`;
        }

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

            console.log(`Navigating to ${baseUrl}`);
            await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
            // Wait for either results or "No datasets found" message
            await Promise.race([
                page.waitForSelector('button p[class*="prose-subhead"]', { timeout: 10000 }).catch(() => null),
                page.waitForSelector(':has-text("No datasets found")', { timeout: 10000 }).catch(() => null)
            ]);
            await page.waitForTimeout(2000);

            // Click "Load more" until exhaustion
            let hasMore = true;
            let loopCount = 0;
            while (hasMore && loopCount < 50) {
                loopCount++;
                try {
                    const loadMoreBtn = page.locator('button', { hasText: /Load more/i });
                    if (await loadMoreBtn.isVisible()) {
                        console.log('[DataGovSgConnector] Clicking Load more...');
                        await loadMoreBtn.click();
                        await page.waitForTimeout(2000);
                    } else {
                        hasMore = false;
                    }
                } catch (e) {
                    hasMore = false;
                }
            }

            // Wait a final time for elements to render
            await page.waitForTimeout(2000);

            // Extract the titles of datasets
            // Based on research, titles in the list are often in button p.prose-subhead-5 or specific prose classes
            const allTitles = await page.locator('button p[class*="prose-subhead"], h1, h2, h3, h4, h5, h6, [role="heading"]').evaluateAll(elements => {
                return elements.map(el => ((el as HTMLElement).innerText || '').trim()).filter(Boolean);
            });

            const ignoreList = [
                'Data explorer', 'Column legend', 'Analyse this dataset with Colab Notebook',
                'Sample OpenAPI query', 'Citation', 'About this dataset', 'Contact', 'Created on',
                'Licence', 'Agency', 'Feedback', 'Open Data Licence', 'Privacy & Terms'
            ];

            const potentialDatasets = Array.from(new Set(allTitles)).filter(title => {
                // Filter out utility text, very short text, or numeric-only
                if (ignoreList.includes(title)) return false;
                if (title.length < 5) return false;
                if (/^\\d+$/.test(title)) return false;
                return true;
            });

            console.log(`[DataGovSgConnector] Extracted ${potentialDatasets.length} dataset titles.`);

            for (const title of potentialDatasets) {
                console.log(`[DataGovSgConnector] Fetching data for: ${title}`);
                let content: string | Buffer = `Agency: ${agency}\nDataset: ${title}`;
                let metadata: Record<string, any> = {};

                if (options?.year) metadata.year = options.year;
                if (options?.month) {
                    const monthMap: Record<string, string> = {
                        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
                        'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
                    };
                    metadata.month = options.monthNumeric || monthMap[options.month.toUpperCase()] || options.month;
                }
                if (options?.agency) metadata.agency = options.agency;

                // Construct customDir: YYYYMM/<agency>
                let year = metadata.year;
                let month = metadata.month;

                if (!year || !month) {
                    const dateToUse = range ? range.start : new Date();
                    year = year || dateToUse.getUTCFullYear().toString();
                    month = month || (dateToUse.getUTCMonth() + 1).toString().padStart(2, '0');
                }

                metadata.customDir = path.join(`${year}${month}`, agency);

                const datasetUrl = `https://data.gov.sg/datasets?query=${encodeURIComponent(title)}`;

                try {
                    const newPage = await context.newPage();
                    await newPage.goto(datasetUrl, { waitUntil: 'load', timeout: 60000 });
                    await newPage.waitForTimeout(3000);

                    const headings = newPage.locator(`[role="heading"]:has-text("${title}"), h1:has-text("${title}"), h2:has-text("${title}"), h3:has-text("${title}")`);
                    if (await headings.first().isVisible()) {
                        await headings.first().click({ force: true });
                        await newPage.waitForTimeout(3000);

                        const [download] = await Promise.all([
                            newPage.waitForEvent('download', { timeout: 15000 }),
                            newPage.click('button:has-text("Download")', { force: true })
                        ]);

                        const downloadPath = await download.path();
                        if (downloadPath) {
                            content = await fs.promises.readFile(downloadPath);
                        }
                        metadata.filename = download.suggestedFilename();
                        console.log(`[DataGovSgConnector] Downloaded ${metadata.filename}`);
                    }
                    await newPage.close();
                } catch (err: any) {
                    console.error(`[DataGovSgConnector] Failed to download data for "${title}": ${err.message}`);
                }

                if (metadata.filename) {
                    const docId = crypto.createHash('sha256').update(this.id + title).digest('hex');
                    const doc: RawDocument = {
                        id: docId,
                        sourceId: this.id,
                        externalId: Buffer.from(title).toString('base64').substring(0, 16),
                        fetchedAt: new Date().toISOString(),
                        publishedAt: new Date().toISOString(),
                        title: title,
                        url: baseUrl, // use search URL as proxy
                        content: content,
                        metadata: metadata
                    };

                    if (onDocument) {
                        await onDocument(doc);
                    }
                    documents.push(doc);
                } else {
                    console.log(`[DataGovSgConnector] Skipping dataset "${title}" as no file was downloaded.`);
                }
            }

        } catch (err: any) {
            console.error(`[DataGovSgConnector] Error: ${err.message}`);
        } finally {
            await browser.close();
        }

        return {
            documents,
            cursor: undefined
        };
    }
}
