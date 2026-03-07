import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class LayoffsFyiConnector {
  source: any;
  url: string;

  constructor(source) {
    this.source = source;
    this.url = process.env.LAYOFF_FYI_URL || "https://layoffs.fyi/";
  }

  async pull(range, cursor = null, options: { query?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const query = options.query || process.env.LAYOFF_FYI_DEFAULT_QUERY || "singapore";
    const targetUrl = `${this.url}?${new URLSearchParams({ q: query }).toString()}`;
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let body = "";
    let finalUrl = targetUrl;
    try {
      const scraped = await scrapePageWithBrowser(targetUrl);
      responseStatus = scraped.status;
      responseHeaders = scraped.headers;
      body = scraped.html;
      finalUrl = scraped.finalUrl;
    } catch (error: any) {
      const err: any = new Error(`layoffs.fyi browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url: targetUrl, finalUrl, params: { query } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `layoffs-fyi-${query}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `layoffs.fyi query: ${query}`,
          url: finalUrl,
          content: {
            source: "layoffs_fyi",
            request: { method: "GET", url: targetUrl, finalUrl, mode: "browser", query },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
