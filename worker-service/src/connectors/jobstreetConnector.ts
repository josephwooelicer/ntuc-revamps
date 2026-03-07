import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class JobstreetConnector {
  source: any;
  searchUrl: string;

  constructor(source) {
    this.source = source;
    this.searchUrl = process.env.JOBSTREET_SEARCH_URL || "https://www.jobstreet.com.sg/en/job-search/";
  }

  async pull(range, cursor = null, options: { query?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const query = options.query || process.env.JOBSTREET_DEFAULT_QUERY || "software engineer";
    const url = `${this.searchUrl}?${new URLSearchParams({ q: query }).toString()}`;

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
      if (responseStatus >= 400) {
        const err: any = new Error(`JobStreet scrape request failed with status ${responseStatus}`);
        err.status = responseStatus;
        err.responseText = body;
        err.request = { method: "GET", url, finalUrl, params: { query } };
        throw err;
      }
    } catch (error: any) {
      if (error?.status) throw error;
      const err: any = new Error(`JobStreet browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: { query } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `jobstreet-${query}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `JobStreet search: ${query}`,
          url: finalUrl,
          content: {
            source: "jobstreet",
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
