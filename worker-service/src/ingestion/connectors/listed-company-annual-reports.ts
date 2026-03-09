import { chromium, Browser, Page } from 'playwright';
import * as crypto from 'crypto';
import * as path from 'path';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';
import { getSGTComponents } from '../utils';

type SearchHit = {
    title: string;
    url: string;
    snippet: string;
    source: string;
    query: string;
};

export class ListedCompanyAnnualReportsConnector implements Connector {
    id = 'src-annual-reports-listed';

    private readonly resultsPagesToScan = 3;
    private readonly maxSearchRetries = 3;
    private readonly googleHosts = ['https://www.google.com', 'https://www.google.com.sg'];
    private readonly userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ];

    async pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        const companies = this.normalizeCompanies(options);
        if (companies.length === 0) {
            console.log('[ListedCompanyAnnualReportsConnector] No company_name/company_names provided.');
            return { documents: [] };
        }

        const browser: Browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
            viewport: {
                width: 1200 + Math.floor(Math.random() * 300),
                height: 720 + Math.floor(Math.random() * 200)
            },
            locale: 'en-SG',
            timezoneId: 'Asia/Singapore'
        });
        const page: Page = await context.newPage();
        const documents: RawDocument[] = [];

        try {
            for (const companyName of companies) {
                const query = this.buildQuery(companyName, range);
                console.log(`[ListedCompanyAnnualReportsConnector] Searching for ${companyName} with query: ${query}`);
                const hits = await this.searchGoogleResults(page, query);

                if (hits.length === 0) {
                    continue;
                }

                const csvHeader = 'Title,URL,Snippet,Source,Query\n';
                const csvRows = hits.map((res) => {
                    const title = `"${(res.title || '').replace(/"/g, '""')}"`;
                    const url = `"${(res.url || '').replace(/"/g, '""')}"`;
                    const snippet = `"${(res.snippet || '').replace(/"/g, '""')}"`;
                    const source = `"${(res.source || '').replace(/"/g, '""')}"`;
                    const searchQuery = `"${(res.query || '').replace(/"/g, '""')}"`;
                    return `${title},${url},${snippet},${source},${searchQuery}`;
                }).join('\n');
                const csvContent = csvHeader + csvRows;

                let customDir = companyName;
                if (range) {
                    const sgt = getSGTComponents(range.start);
                    customDir = path.join(companyName, sgt.yyyymm);
                }

                const doc: RawDocument = {
                    id: crypto.createHash('sha256').update(`${this.id}:${companyName}:${customDir}`).digest('hex'),
                    sourceId: this.id,
                    externalId: `annual_reports_${companyName.toLowerCase().replace(/\s+/g, '_')}`,
                    fetchedAt: new Date().toISOString(),
                    title: `${companyName} Annual Report Search Results`,
                    url: '',
                    content: csvContent,
                    metadata: {
                        company_name: companyName,
                        query,
                        queryText: query,
                        filterParams: {
                            company_name: companyName,
                            range_start: range?.start.toISOString() ?? null,
                            range_end: range?.end.toISOString() ?? null
                        },
                        retrievalUrl: 'https://www.google.com/search',
                        pageNumber: 1,
                        result_count: hits.length,
                        filename: 'annual_reports.csv',
                        customDir
                    }
                };

                if (onDocument) {
                    await onDocument(doc);
                }
                documents.push(doc);
            }

            return { documents };
        } catch (err: any) {
            console.error(`[ListedCompanyAnnualReportsConnector] Failed: ${err.message}`);
            return { documents };
        } finally {
            await browser.close();
        }
    }

    private normalizeCompanies(options?: Record<string, any>): string[] {
        const fromArray = Array.isArray(options?.company_names) ? options.company_names : [];
        const fromSingle = typeof options?.company_name === 'string' ? [options.company_name] : [];
        const combined = [...fromArray, ...fromSingle]
            .map((v: any) => String(v || '').trim())
            .filter(Boolean);
        const deduped: string[] = [];
        const seen: Record<string, boolean> = {};
        for (const name of combined) {
            if (seen[name]) {
                continue;
            }
            seen[name] = true;
            deduped.push(name);
        }
        return deduped;
    }

    private buildQuery(companyName: string, range?: IngestionRange): string {
        let query = `${companyName} annual report filetype:pdf (site:links.sgx.com OR site:sgx.com OR site:annualreports.com)`;
        if (range) {
            const startSgt = getSGTComponents(range.start);
            const endSgt = getSGTComponents(range.end);
            query += ` after:${startSgt.isoDate} before:${endSgt.isoDate}`;
        }
        return query;
    }

    private async searchGoogleResults(page: Page, query: string): Promise<SearchHit[]> {
        const hits: SearchHit[] = [];

        for (let i = 0; i < this.resultsPagesToScan; i += 1) {
            const pageResult = await this.fetchGoogleResultsPage(page, query, i * 10);
            if (pageResult.challengeDetected) {
                console.log(`[ListedCompanyAnnualReportsConnector] Google challenge detected on page ${i + 1}.`);
                break;
            }
            if (pageResult.responseStatus === 429) {
                console.log('[ListedCompanyAnnualReportsConnector] Google rate-limited the request.');
                break;
            }

            const pageHits = pageResult.results;
            if (pageHits.length === 0) {
                const pageTitle = await page.title().catch(() => '');
                const currentUrl = page.url();
                console.log(`[ListedCompanyAnnualReportsConnector] No parsed hits on page ${i + 1}. title="${pageTitle}" url="${currentUrl}"`);
                break;
            }

            hits.push(...pageHits);
        }

        return this.dedupeByUrl(hits);
    }

    private async fetchGoogleResultsPage(
        page: Page,
        query: string,
        start: number
    ): Promise<{ results: SearchHit[]; responseStatus: number | null; challengeDetected: boolean }> {
        for (let attempt = 1; attempt <= this.maxSearchRetries; attempt += 1) {
            const host = this.googleHosts[Math.floor(Math.random() * this.googleHosts.length)];
            const searchUrl = `${host}/search?q=${encodeURIComponent(query)}&num=10&start=${start}&hl=en&pws=0`;

            await new Promise((r) => setTimeout(r, 1800 + Math.random() * 2400));
            const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
            await this.humanizePage(page);

            const responseStatus = response?.status() ?? null;
            const challengeDetected = await this.isGoogleChallengePage(page);
            if (challengeDetected || responseStatus === 429) {
                await new Promise((r) => setTimeout(r, (3000 + Math.random() * 5000) * attempt));
                continue;
            }

            const results = await page.evaluate((searchQuery) => {
                const items: SearchHit[] = [];
                const seen = new Set<string>();
                document.querySelectorAll('div.g, div.tF2Cxc, div.MjjYud').forEach((container) => {
                    const titleEl = container.querySelector('h3');
                    const anchorEl = container.querySelector('a[href]');
                    const snippetEl = container.querySelector('div.VwiC3b, .st, .MUFwZ');
                    const title = titleEl?.textContent?.trim() || '';
                    const rawHref = anchorEl?.getAttribute('href') || '';
                    let href = '';
                    if (rawHref.startsWith('http')) {
                        href = rawHref;
                    } else if (rawHref.startsWith('/url?')) {
                        try {
                            const parsed = new URL(rawHref, 'https://www.google.com');
                            const target = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
                            if (target.startsWith('http')) {
                                href = target;
                            }
                        } catch {
                            href = '';
                        }
                    }
                    const snippet = snippetEl?.textContent?.trim() || '';
                    if (!title || !href || seen.has(href)) {
                        return;
                    }
                    seen.add(href);
                    let source = '';
                    try {
                        source = new URL(href).hostname;
                    } catch {
                        source = '';
                    }
                    items.push({
                        title,
                        url: href,
                        snippet,
                        source,
                        query: searchQuery
                    });
                });

                document.querySelectorAll('a[href]').forEach((anchor) => {
                    const titleEl = anchor.querySelector('h3');
                    if (!titleEl) return;
                    const title = titleEl.textContent?.trim() || '';
                    const rawHref = anchor.getAttribute('href') || '';
                    let href = '';
                    if (rawHref.startsWith('http')) {
                        href = rawHref;
                    } else if (rawHref.startsWith('/url?')) {
                        try {
                            const parsed = new URL(rawHref, 'https://www.google.com');
                            const target = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
                            if (target.startsWith('http')) {
                                href = target;
                            }
                        } catch {
                            href = '';
                        }
                    }
                    const container = anchor.closest('div');
                    const snippetEl = container?.querySelector('div.VwiC3b, .st, .MUFwZ') || null;
                    const snippet = snippetEl?.textContent?.trim() || '';
                    if (!title || !href || seen.has(href)) {
                        return;
                    }
                    seen.add(href);
                    let source = '';
                    try {
                        source = new URL(href).hostname;
                    } catch {
                        source = '';
                    }
                    items.push({
                        title,
                        url: href,
                        snippet,
                        source,
                        query: searchQuery
                    });
                });

                return items;
            }, query);

            return { results, responseStatus, challengeDetected: false };
        }
        return { results: [], responseStatus: 429, challengeDetected: true };
    }

    private dedupeByUrl(items: SearchHit[]): SearchHit[] {
        const byUrl = new Map<string, SearchHit>();
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

    private async humanizePage(page: Page): Promise<void> {
        await page.mouse.move(100 + Math.random() * 600, 120 + Math.random() * 400, { steps: 10 });
        await page.mouse.wheel(0, 100 + Math.floor(Math.random() * 300));
        await new Promise((r) => setTimeout(r, 250 + Math.random() * 500));
    }

    private async isGoogleChallengePage(page: Page): Promise<boolean> {
        const url = page.url().toLowerCase();
        if (url.includes('/sorry/')) return true;
        const bodyText = (await page.textContent('body').catch(() => '')) || '';
        const text = bodyText.toLowerCase();
        return (
            text.includes('unusual traffic from your computer network') ||
            text.includes('our systems have detected unusual traffic') ||
            text.includes('to continue, please type the characters') ||
            text.includes('detected unusual traffic')
        );
    }
}
