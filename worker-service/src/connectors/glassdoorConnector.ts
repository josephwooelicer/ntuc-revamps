import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class GlassdoorConnector {
  source: any;
  searchUrl: string;

  constructor(source) {
    this.source = source;
    this.searchUrl = process.env.GLASSDOOR_SEARCH_URL || "https://www.glassdoor.com/Search/results.htm";
  }

  async pull(range, cursor = null, options: { query?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const query = options.query || process.env.GLASSDOOR_DEFAULT_QUERY || "Singapore layoffs";
    const url = `${this.searchUrl}?${new URLSearchParams({ keyword: query }).toString()}`;

    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let body = "";
    let finalUrl = url;
    try {
      const scraped = await scrapePageWithBrowser(url);
      responseStatus = scraped.status;
      responseHeaders = scraped.headers;
      body = scraped.html;
      finalUrl = scraped.finalUrl;
    } catch (error: any) {
      const err: any = new Error(`Glassdoor browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: { query } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `glassdoor-${query}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `Glassdoor query: ${query}`,
          url: finalUrl,
          content: {
            source: "glassdoor",
            request: { method: "GET", url, finalUrl, mode: "browser", query },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
