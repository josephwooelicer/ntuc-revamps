import { chromium, Browser, Page } from 'playwright';
import crypto from 'crypto';
import path from 'path';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';

export class NewsGoogleSearchConnector implements Connector {
    id = 'src-news';
    toScreenshot = false;

    async pull(range?: IngestionRange, cursor?: string, options?: Record<string, any>): Promise<IngestionResult> {
        const companyName = options?.company_name || '';
        const newsSite = options?.news_site || '';

        console.log(`[NewsGoogleSearchConnector] Pulling for ${companyName} (${newsSite}) in range ${range?.start.toISOString()} to ${range?.end.toISOString()}`);

        let query = companyName;
        if (newsSite) {
            query += ` site:${newsSite}`;
        }

        const newsSites = newsSite ? [newsSite] : ['straitstimes.com', 'channelnewsasia.com', 'businesstimes.com.sg'];
        const results: any[] = [];

        const browser: Browser = await chromium.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });
        const page: Page = await context.newPage();

        try {
            for (const site of newsSites) {
                let siteQuery = `${companyName}`;

                if (range) {
                    const startStr = range.start.toISOString().split('T')[0];
                    const endStr = range.end.toISOString().split('T')[0];
                    siteQuery += ` after:${startStr} before:${endStr}`;
                }

                siteQuery += ` site:${site}`;

                let searchUrl = `https://www.google.com/search?q=${encodeURIComponent(siteQuery)}`;

                console.log(`[NewsGoogleSearchConnector] Trying Google for: ${siteQuery}`);

                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                let response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);

                if (response?.status() === 429) {
                    console.log(`[NewsGoogleSearchConnector] Rate limited for ${site}, skipping Google...`);
                    continue;
                }

                const siteResults = await page.evaluate(() => {
                    const items: any[] = [];
                    document.querySelectorAll('div.g, div.tF2Cxc').forEach(el => {
                        const titleEl = el.querySelector('h3');
                        const linkEl = el.querySelector('a');
                        const snippetEl = el.querySelector('div.VwiC3b, .st, .MUFwZ');
                        const href = linkEl?.getAttribute('href');
                        const title = titleEl?.textContent?.trim();
                        if (title && href && href.startsWith('http')) {
                            items.push({ title, url: href, snippet: snippetEl?.textContent?.trim() || '' });
                        }
                    });
                    return items;
                });

                if (siteResults.length > 0) {
                    results.push(...siteResults);
                    console.log(`[NewsGoogleSearchConnector] Found ${siteResults.length} results for ${site}`);
                }
            }

            // Fallback to simple search if no results found
            if (results.length === 0) {
                console.log('[NewsGoogleSearchConnector] No site-specific results, trying simple Google search...');
                const simpleUrl = `https://www.google.com/search?q=${encodeURIComponent(companyName + " news")}`;
                await page.goto(simpleUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);

                const simpleResults = await page.evaluate(() => {
                    const items: any[] = [];
                    document.querySelectorAll('div.g, div.tF2Cxc').forEach(el => {
                        const titleEl = el.querySelector('h3');
                        const linkEl = el.querySelector('a');
                        const snippetEl = el.querySelector('div.VwiC3b, .st');
                        const href = linkEl?.getAttribute('href');
                        const title = titleEl?.textContent?.trim();
                        if (title && href && href.startsWith('http')) {
                            items.push({ title, url: href, snippet: snippetEl?.textContent?.trim() || '' });
                        }
                    });
                    return items;
                });
                results.push(...simpleResults);
            }

            // Capture screenshot
            const screenshot = this.toScreenshot ? await page.screenshot({ fullPage: true }) : null;

            // Construct custom directory path
            let customDir = `${companyName}`;
            if (range) {
                const startStr = range.start.toISOString().split('T')[0];
                const endStr = range.end.toISOString().split('T')[0];
                customDir += ` | ${startStr} - ${endStr}`;
            }
            if (newsSite) {
                customDir = path.join(customDir, newsSite);
            } else {
                customDir = path.join(customDir, 'general');
            }

            // Generate CSV
            const csvHeader = 'Title,URL,Snippet\n';
            const csvRows = results.map(res => {
                const title = `"${(res.title || '').replace(/"/g, '""')}"`;
                const url = `"${(res.url || '').replace(/"/g, '""')}"`;
                const snippet = `"${(res.snippet || '').replace(/"/g, '""')}"`;
                return `${title},${url},${snippet}`;
            }).join('\n');
            const csvContent = csvHeader + csvRows;

            const documents: RawDocument[] = [];

            // 1. CSV Document
            documents.push({
                id: crypto.createHash('sha256').update(this.id + 'csv' + customDir).digest('hex'),
                sourceId: this.id,
                externalId: 'search_results_csv',
                fetchedAt: new Date().toISOString(),
                title: 'Search Results CSV',
                url: '',
                content: csvContent,
                metadata: {
                    company_name: companyName,
                    news_site: newsSite,
                    customDir: customDir,
                    filename: 'data.csv'
                }
            });

            // 2. Screenshot Document
            if (this.toScreenshot) {
                documents.push({
                    id: crypto.createHash('sha256').update(this.id + 'screenshot' + customDir).digest('hex'),
                    sourceId: this.id,
                    externalId: 'search_results_screenshot',
                    fetchedAt: new Date().toISOString(),
                    title: 'Search Results Screenshot',
                    url: '',
                    content: screenshot!,
                    metadata: {
                        company_name: companyName,
                        news_site: newsSite,
                        customDir: customDir,
                        filename: 'screenshot.png'
                    }
                });
            }

            console.log(`[NewsGoogleSearchConnector] Found total ${results.length} results. Saved in: ${customDir}`);

            await browser.close();
            return {
                documents,
                cursor: undefined
            };
        } catch (err: any) {
            console.error(`[NewsGoogleSearchConnector] Failed.`, err.message);
            await browser.close();
            return { documents: [] };
        }
    }
}
