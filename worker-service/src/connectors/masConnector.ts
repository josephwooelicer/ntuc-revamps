import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class MasConnector {
  source: any;
  pageUrl: string;

  constructor(source) {
    this.source = source;
    this.pageUrl = process.env.MAS_STATS_URL || "https://eservices.mas.gov.sg/statistics/fdanet/";
  }

  async pull(range, cursor = null, _options = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const url = this.pageUrl;
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
      const err: any = new Error(`MAS browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: {} };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `mas-stats-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: "MAS Statistics",
          url: finalUrl,
          content: {
            source: "mas",
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
