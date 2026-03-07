import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class UraConnector {
  source: any;
  pageUrl: string;

  constructor(source) {
    this.source = source;
    this.pageUrl = process.env.URA_MARKET_STATS_URL || "https://www.ura.gov.sg/Corporate/Property/Research/Market-Statistics";
  }

  async pull(range, cursor = null, _options = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const url = this.pageUrl;

    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let body: any;
    let finalUrl = url;
    try {
      const scraped = await scrapePageWithBrowser(url);
      responseStatus = scraped.status;
      responseHeaders = scraped.headers;
      body = scraped.html;
      finalUrl = scraped.finalUrl;
    } catch (error: any) {
      const err: any = new Error(`URA browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: {} };
      throw err;
    }

    const fingerprint = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `ura-market-stats-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: "URA Market Statistics",
          url: finalUrl,
          content: {
            source: "ura",
            request: { method: "GET", url, finalUrl, mode: "browser" },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
