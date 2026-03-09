import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';
import { fromSGT, getSGTComponents } from '../utils';

/**
 * EgazetteConnector is responsible for ingesting gazette notices from the Singapore
 * e-Gazette portal (https://www.egazette.gov.sg).
 *
 * The portal uses Algolia InstantSearch to render results. Search results include
 * direct PDF links hosted on assets.egazette.gov.sg.
 *
 * Search URL structure:
 *   https://www.egazette.gov.sg/egazette-search/?q=<query>&minYear=<YYYY>&maxYear=<YYYY>&minMonth=<M>&maxMonth=<M>
 *
 * Example – "Twelve Cupcakes" notices for February 2026:
 *   https://www.egazette.gov.sg/egazette-search/?q=Twelve%20Cupcakes&minYear=2026&maxYear=2026&minMonth=2&maxMonth=2
 *
 * URL query parameters:
 *   - q         Company name / keyword to search for (URL-encoded).
 *   - minYear   Start year of the publication date range (YYYY).
 *   - maxYear   End year of the publication date range (YYYY).
 *   - minMonth  Start month (1–12, no leading zero).
 *   - maxMonth  End month (1–12, no leading zero).
 *
 * Storage path: data-lake/raw/src-egazette/<company>/<year>/<month>/<filename>.pdf
 */
export class EgazetteConnector implements Connector {
    id = 'src-egazette';

    /**
     * Executes the pull operation for egazette.gov.sg.
     *
     * Supported `options`:
     *   - `query`  {string}  Company name to search for (maps to the `q` URL param, URL-encoded).
     *   - `month`  {number}  Month of publication to filter by (1–12, maps to `minMonth`/`maxMonth`).
     *   - `year`   {number}  Year of publication to filter by (YYYY, maps to `minYear`/`maxYear`).
     *
     * @param range   Optional date range (currently not used; prefer explicit month/year options).
     * @param cursor  Pagination cursor (currently not used by this connector).
     * @param options Search options – see above.
     * @returns A promise resolving to the IngestionResult containing fetched gazette documents.
     */
    async pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        const sgt = range ? getSGTComponents(range.start) : getSGTComponents(new Date());
        const month: number = options?.month ?? sgt.month;
        const year: number = options?.year ?? sgt.year;

        // Slugify company name for the storage folder segment
        const companyFolder = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';

        const searchUrl = `https://www.egazette.gov.sg/egazette-search/?q=${encodeURIComponent(query)}&minYear=${year}&maxYear=${year}&minMonth=${month}&maxMonth=${month}`;

        console.log(`[EgazetteConnector] Searching: ${searchUrl}`);

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

            await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });

            // Wait for Algolia to hydrate and render the hits list
            await page.waitForSelector('.ais-Hits, .ais-InfiniteHits', { timeout: 15000 }).catch(() => {
                console.log('[EgazetteConnector] Algolia hits container not found, proceeding anyway...');
            });
            await page.waitForTimeout(3000);

            // Collect direct PDF links rendered by Algolia (hosted on assets.egazette.gov.sg)
            const pdfLinks: string[] = await page.evaluate(() =>
                Array.from(document.querySelectorAll('a[href]'))
                    .map((a: any) => a.href as string)
                    .filter(href => href.includes('assets.egazette.gov.sg') && href.endsWith('.pdf'))
            );

            const uniquePdfLinks = Array.from(new Set(pdfLinks));
            console.log(`[EgazetteConnector] Found ${uniquePdfLinks.length} PDF link(s).`);

            for (const pdfUrl of uniquePdfLinks) {
                console.log(`[EgazetteConnector] Downloading: ${pdfUrl}`);
                try {
                    const response = await page.request.get(pdfUrl, { timeout: 30000 });
                    if (!response.ok()) {
                        console.error(`[EgazetteConnector] Failed to fetch PDF (${response.status()}): ${pdfUrl}`);
                        continue;
                    }

                    const pdfBuffer = Buffer.from(await response.body());
                    const filename = decodeURIComponent(path.basename(new URL(pdfUrl).pathname));
                    const docId = crypto.createHash('sha256').update(this.id + pdfUrl).digest('hex');

                    const doc: RawDocument = {
                        id: docId,
                        sourceId: this.id,
                        externalId: Buffer.from(pdfUrl).toString('base64').substring(0, 24),
                        fetchedAt: new Date().toISOString(),
                        publishedAt: fromSGT(year, month, 1).toISOString(),
                        title: filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
                        url: pdfUrl,
                        content: pdfBuffer,
                        metadata: {
                            company: companyFolder,
                            query,
                            year: year.toString(),
                            month: month.toString().padStart(2, '0'),
                            filename
                        }
                    };

                    if (onDocument) {
                        await onDocument(doc);
                    }
                    documents.push(doc);

                    console.log(`[EgazetteConnector] Downloaded: ${filename}`);
                } catch (err: any) {
                    console.error(`[EgazetteConnector] Error downloading ${pdfUrl}: ${err.message}`);
                }
            }
        } catch (err: any) {
            console.error(`[EgazetteConnector] Error: ${err.message}`);
        } finally {
            await browser.close();
        }

        return {
            documents,
            cursor: undefined
        };
    }
}
