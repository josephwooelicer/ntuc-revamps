import { chromium, Browser, Page } from 'playwright';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';

export class RedditSentimentConnector implements Connector {
    id = 'src-reddit-sentiment';
    toScreenshot = false;

    async pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult> {
        const companyName = options?.company_name || '';

        console.log(`[RedditSentimentConnector] Pulling for ${companyName}`);

        let customDir = '';
        if (range) {
            const year = range.start.getUTCFullYear();
            const month = (range.start.getUTCMonth() + 1).toString().padStart(2, '0');
            const yyyymm = `${year}${month}`;
            customDir = path.join(yyyymm, companyName);
        } else {
            customDir = companyName;
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
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });
        const page: Page = await context.newPage();

        try {
            // 1. Search Google for Reddit posts
            let searchQuery = ` ${companyName}`;

            if (range) {
                const startStr = range.start.toISOString().split('T')[0];
                const endStr = range.end.toISOString().split('T')[0];
                searchQuery += ` after:${startStr} before:${endStr}`;
            }

            searchQuery += ` site:reddit.com/r/Singapore`;

            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

            console.log(`[RedditSentimentConnector] Searching Google: ${searchQuery}`);
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

            const postUrls = await page.evaluate(() => {
                const links: string[] = [];
                // More robust selection: any anchor that points to a reddit comment thread
                document.querySelectorAll('a').forEach(el => {
                    const href = el.getAttribute('href');
                    if (href && (href.includes('reddit.com/r/') || href.includes('reddit.com/user/')) && href.includes('/comments/')) {
                        // Clean up URL to prevent fragments/queries affecting JSON call
                        const cleanUrl = href.split('?')[0].split('#')[0];
                        if (!links.includes(cleanUrl)) {
                            links.push(cleanUrl);
                        }
                    }
                });
                return links;
            });

            console.log(`[RedditSentimentConnector] Found ${postUrls.length} Reddit posts.`);

            // Capture screenshot
            const screenshot = this.toScreenshot ? await page.screenshot({ fullPage: true }) : null;

            const documents: RawDocument[] = [];

            // 2. For each post, get comments via .json
            for (const postUrl of postUrls) {
                const jsonUrl = postUrl.endsWith('/') ? `${postUrl.slice(0, -1)}.json` : `${postUrl}.json`;
                console.log(`[RedditSentimentConnector] Fetching comments for: ${postUrl}`);

                try {
                    // Navigate to the post page first to establish a session/cookies
                    // await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
                    // await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

                    // Now try to get the JSON
                    await page.goto(jsonUrl, { waitUntil: 'domcontentloaded' });
                    const content = await page.evaluate(() => document.body.innerText);

                    if (content.includes("You've been blocked") || content.includes("Whoa there")) {
                        console.log(`[RedditSentimentConnector] Blocked by Reddit for ${postUrl}`);
                        continue;
                    }

                    const data = JSON.parse(content);

                    // Reddit JSON structure: [post_info, comments_info]
                    if (Array.isArray(data) && data.length > 1) {
                        const postData = data[0].data.children[0].data;
                        const commentsData = data[1].data.children;
                        const postTitle = postData.title;

                        const comments: any[] = [];
                        this.extractComments(commentsData, comments);

                        if (comments.length > 0) {
                            // Generate CSV
                            const csvHeader = 'Author,Body,Score,CreatedUTC\n';
                            const csvRows = comments.map(c => {
                                const author = `"${(c.author || '').replace(/"/g, '""')}"`;
                                const body = `"${(c.body || '').replace(/"/g, '""')}"`;
                                const score = c.score || 0;
                                const created = c.created_utc || '';
                                return `${author},${body},${score},${created}`;
                            }).join('\n');
                            const csvContent = csvHeader + csvRows;

                            const postId = postData.id;
                            const safeTitle = postTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);

                            const doc: RawDocument = {
                                id: crypto.createHash('sha256').update(this.id + postId).digest('hex'),
                                sourceId: this.id,
                                externalId: postId,
                                title: `Comments: ${postTitle}`,
                                url: postUrl,
                                fetchedAt: new Date().toISOString(),
                                publishedAt: new Date(postData.created_utc * 1000).toISOString(),
                                content: csvContent,
                                metadata: {
                                    company_name: companyName,
                                    post_id: postId,
                                    post_title: postTitle,
                                    filename: `${safeTitle}_comments.csv`,
                                    customDir: customDir
                                }
                            };

                            if (onDocument) {
                                await onDocument(doc);
                            }
                            documents.push(doc);
                        }
                    }
                } catch (e: any) {
                    console.error(`[RedditSentimentConnector] Failed to parse JSON for ${postUrl}:`, e.message);
                }

                // Small delay to be polite
                await new Promise(r => setTimeout(r, 1000));
            }

            // Add Screenshot Document if captured
            if (this.toScreenshot && screenshot) {
                const screenshotDoc: RawDocument = {
                    id: crypto.createHash('sha256').update(this.id + 'screenshot' + customDir).digest('hex'),
                    sourceId: this.id,
                    externalId: 'search_results_screenshot',
                    fetchedAt: new Date().toISOString(),
                    title: 'Search Results Screenshot',
                    url: '',
                    content: screenshot,
                    metadata: {
                        company_name: companyName,
                        customDir: customDir,
                        filename: 'screenshot.png'
                    }
                };
                if (onDocument) {
                    await onDocument(screenshotDoc);
                }
                documents.push(screenshotDoc);
            }

            await browser.close();
            return { documents };
        } catch (err: any) {
            console.error(`[RedditSentimentConnector] Error:`, err.message);
            await browser.close();
            return { documents: [] };
        }
    }

    private extractComments(children: any[], results: any[]) {
        for (const child of children) {
            if (child.kind === 't1') { // t1 is comment
                const data = child.data;
                results.push({
                    author: data.author,
                    body: data.body,
                    score: data.score,
                    created_utc: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : ''
                });

                // Recursively extract replies
                if (data.replies && data.replies.data && data.replies.data.children) {
                    this.extractComments(data.replies.data.children, results);
                }
            }
        }
    }
}
