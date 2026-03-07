import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class GoogleTrendsConnector {
  source: any;
  exploreUrl: string;

  constructor(source) {
    this.source = source;
    this.exploreUrl = process.env.GOOGLE_TRENDS_EXPLORE_URL || "https://trends.google.com/trends/explore";
  }

  async pull(range, cursor = null, options: { query?: string; geo?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const query = options.query || process.env.GOOGLE_TRENDS_DEFAULT_QUERY || "retrenchment";
    const geo = options.geo || process.env.GOOGLE_TRENDS_DEFAULT_GEO || "SG";
    const url = `${this.exploreUrl}?${new URLSearchParams({ q: query, geo }).toString()}`;

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
      const err: any = new Error(`Google Trends browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: { query, geo } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `google-trends-${query}-${geo}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `Google Trends: ${query} (${geo})`,
          url: finalUrl,
          content: {
            source: "google_trends",
            request: { method: "GET", url, finalUrl, mode: "browser", query, geo },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
