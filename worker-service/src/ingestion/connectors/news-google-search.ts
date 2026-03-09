import { chromium, Browser, Page } from 'playwright';
import * as crypto from 'crypto';
import * as path from 'path';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';
import { getSGTComponents, splitRangeByMonthInSgt } from '../utils';

export class NewsGoogleSearchConnector implements Connector {
    id = 'src-news';
    toScreenshot = true;
    private readonly maxSearchRetries = 3;
    private readonly maxGooglePages = 1;
    private readonly googleHosts = ['https://www.google.com', 'https://www.google.com.sg'];
    private readonly userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ];
    private readonly defaultNewsSites = [
        'straitstimes.com',
        'channelnewsasia.com',
        'todayonline.com',
        'businesstimes.com.sg'
    ];

    async pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        const companyName = options?.company_name || '';

        console.log(`[NewsGoogleSearchConnector] Pulling for ${companyName} (all configured outlets) in range ${range?.start.toISOString()} to ${range?.end.toISOString()}`);

        const newsSites = this.defaultNewsSites;
        const results: any[] = [];
        const executedQueries: string[] = [];

        const browser: Browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        let context = await this.createSteadyContext(browser);
        let page: Page = await context.newPage();

        try {
            const monthlyRanges = range ? splitRangeByMonthInSgt(range.start, range.end) : [undefined];

            for (const monthlyRange of monthlyRanges) {
                let siteQuery = `${companyName}`;
                if (monthlyRange) {
                    const startSgt = getSGTComponents(monthlyRange.start);
                    const endSgt = getSGTComponents(monthlyRange.end);
                    siteQuery += ` after:${startSgt.isoDate} before:${endSgt.isoDate}`;
                }
                siteQuery += ` (${newsSites.map(site => `site:${site}`).join(' OR ')})`;
                executedQueries.push(siteQuery);

                console.log(`[NewsGoogleSearchConnector] Trying Google for: ${siteQuery}`);
                const searchResults = await this.fetchGoogleResults(page, siteQuery);
                if (searchResults.challengeDetected) {
                    console.log('[NewsGoogleSearchConnector] Google challenge detected. Cooling down and rotating browser context...');
                    await page.close().catch(() => undefined);
                    await context.close().catch(() => undefined);
                    await this.sleep(15000 + Math.random() * 10000);
                    context = await this.createSteadyContext(browser);
                    page = await context.newPage();
                    continue;
                }
                if (searchResults.responseStatus === 429) {
                    console.log('[NewsGoogleSearchConnector] Rate limited, skipping Google for this month...');
                    continue;
                }
                const siteResults = searchResults.results.map(item => ({ ...item, outlet: this.resolveOutlet(item.url, newsSites) }));
                if (siteResults.length > 0) {
                    results.push(...siteResults);
                    console.log(`[NewsGoogleSearchConnector] Found ${siteResults.length} results from combined outlet query`);
                }
            }

            const dedupedResults = this.dedupeByUrl(results);

            // Capture screenshot
            const screenshot = this.toScreenshot ? await page.screenshot({ fullPage: true }) : null;

            // Construct custom directory path
            let customDir = '';
            if (range) {
                const startSgt = getSGTComponents(range.start);
                const endSgt = getSGTComponents(range.end);
                customDir = path.join(companyName, `${startSgt.yyyymm}_${endSgt.yyyymm}`);
            } else {
                customDir = companyName;
            }
            // Generate CSV
            const csvHeader = 'Title,URL,Snippet,Outlet\n';
            const csvRows = dedupedResults.map(res => {
                const title = `"${(res.title || '').replace(/"/g, '""')}"`;
                const url = `"${(res.url || '').replace(/"/g, '""')}"`;
                const snippet = `"${(res.snippet || '').replace(/"/g, '""')}"`;
                const outlet = `"${(res.outlet || '').replace(/"/g, '""')}"`;
                return `${title},${url},${snippet},${outlet}`;
            }).join('\n');
            const csvContent = csvHeader + csvRows;

            const documents: RawDocument[] = [];

            // 1. CSV Document — only save if there are results
            if (dedupedResults.length > 0) {
                const csvDoc: RawDocument = {
                    id: crypto.createHash('sha256').update(this.id + 'csv' + customDir).digest('hex'),
                    sourceId: this.id,
                    externalId: 'search_results_csv',
                    fetchedAt: new Date().toISOString(),
                    title: 'Search Results CSV',
                    url: '',
                    content: csvContent,
                    metadata: {
                        company_name: companyName,
                        customDir: customDir,
                        filename: 'data.csv',
                        queryText: executedQueries.join(' || '),
                        filterParams: {
                            company_name: companyName,
                            outlets: newsSites,
                            range_start: range?.start.toISOString() ?? null,
                            range_end: range?.end.toISOString() ?? null
                        },
                        retrievalUrl: 'https://www.google.com/search',
                        pageNumber: 1
                    }
                };
                if (onDocument) {
                    await onDocument(csvDoc);
                }
                documents.push(csvDoc);
            }

            // 2. Screenshot Document
            if (this.toScreenshot) {
                const screenshotDoc: RawDocument = {
                    id: crypto.createHash('sha256').update(this.id + 'screenshot' + customDir).digest('hex'),
                    sourceId: this.id,
                    externalId: 'search_results_screenshot',
                    fetchedAt: new Date().toISOString(),
                    title: 'Search Results Screenshot',
                    url: '',
                    content: screenshot!,
                    metadata: {
                        company_name: companyName,
                        customDir: customDir,
                        filename: 'screenshot.png',
                        queryText: executedQueries.join(' || '),
                        filterParams: {
                            company_name: companyName,
                            outlets: newsSites,
                            range_start: range?.start.toISOString() ?? null,
                            range_end: range?.end.toISOString() ?? null
                        },
                        retrievalUrl: 'https://www.google.com/search',
                        pageNumber: 1
                    }
                };
                if (onDocument) {
                    await onDocument(screenshotDoc);
                }
                documents.push(screenshotDoc);
            }

            console.log(`[NewsGoogleSearchConnector] Found total ${results.length} results (${dedupedResults.length} unique URLs). Saved in: ${customDir}`);

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

    private async fetchGoogleResults(page: Page, query: string): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; responseStatus: number | null; challengeDetected: boolean; }> {
        const aggregatedResults: Array<{ title: string; url: string; snippet: string }> = [];
        let latestStatus: number | null = null;

        for (let pageIndex = 0; pageIndex < this.maxGooglePages; pageIndex++) {
            const pageStart = pageIndex * 10;
            const pageResult = await this.fetchGoogleResultsPage(page, query, pageStart);
            latestStatus = pageResult.responseStatus;
            if (pageResult.challengeDetected) {
                return { results: aggregatedResults, responseStatus: latestStatus, challengeDetected: true };
            }
            if (pageResult.responseStatus === 429) {
                return { results: aggregatedResults, responseStatus: 429, challengeDetected: false };
            }
            if (pageResult.results.length === 0) {
                break;
            }
            aggregatedResults.push(...pageResult.results);
        }

        return { results: aggregatedResults, responseStatus: latestStatus, challengeDetected: false };
    }

    private async fetchGoogleResultsPage(page: Page, query: string, start: number): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; responseStatus: number | null; challengeDetected: boolean; }> {
        for (let attempt = 1; attempt <= this.maxSearchRetries; attempt++) {
            await this.sleep(this.randomBetween(1800, 4200));
            const host = this.googleHosts[Math.floor(Math.random() * this.googleHosts.length)];
            const searchUrl = `${host}/search?q=${encodeURIComponent(query)}&hl=en&num=10&pws=0&start=${start}`;
            const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);

            await this.humanizePage(page);

            const challengeDetected = await this.isGoogleChallengePage(page);
            const responseStatus = response?.status() ?? null;
            if (challengeDetected || responseStatus === 429) {
                const cooldownMs = this.randomBetween(4000, 9000) * attempt;
                await this.sleep(cooldownMs);
                continue;
            }

            const results = await page.evaluate(() => {
                const items: any[] = [];
                document.querySelectorAll('div.g, div.tF2Cxc').forEach((el) => {
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
            return { results, responseStatus, challengeDetected: false };
        }
        return { results: [], responseStatus: 429, challengeDetected: true };
    }

    private resolveOutlet(url: string, allowedSites: string[]): string {
        try {
            const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
            const matchedSite = allowedSites.find(site =>
                hostname === site || hostname.endsWith(`.${site}`)
            );
            return matchedSite ?? hostname;
        } catch {
            return 'unknown';
        }
    }

    private async createSteadyContext(browser: Browser) {
        const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        const viewport = {
            width: this.randomBetween(1200, 1520),
            height: this.randomBetween(720, 980)
        };
        const context = await browser.newContext({
            userAgent,
            locale: 'en-SG',
            timezoneId: 'Asia/Singapore',
            viewport
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        return context;
    }

    private async humanizePage(page: Page): Promise<void> {
        await this.sleep(this.randomBetween(500, 1200));
        await page.mouse.move(this.randomBetween(100, 500), this.randomBetween(120, 420), { steps: this.randomBetween(8, 20) });
        if (Math.random() < 0.6) {
            await page.mouse.wheel(0, this.randomBetween(200, 900));
            await this.sleep(this.randomBetween(300, 900));
        }
    }

    private async isGoogleChallengePage(page: Page): Promise<boolean> {
        const url = page.url().toLowerCase();
        if (url.includes('/sorry/') || url.includes('consent.google.com')) {
            return true;
        }
        const bodyText = (await page.textContent('body').catch(() => ''))?.toLowerCase() || '';
        const markers = [
            'unusual traffic',
            'our systems have detected',
            'solve this captcha',
            'verify you are a human',
            'before you continue to google search'
        ];
        return markers.some(marker => bodyText.includes(marker));
    }

    private randomBetween(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    private dedupeByUrl(items: any[]): any[] {
        const byUrl = new Map<string, any>();
        for (const item of items) {
            const normalizedUrl = this.normalizeUrl(item.url);
            if (!normalizedUrl) {
                continue;
            }
            if (!byUrl.has(normalizedUrl)) {
                byUrl.set(normalizedUrl, { ...item, url: normalizedUrl });
            }
        }
        return Array.from(byUrl.values());
    }

    private normalizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            if (parsed.pathname.endsWith('/')) {
                parsed.pathname = parsed.pathname.slice(0, -1);
            }
            return parsed.toString();
        } catch {
            return '';
        }
    }
}
