import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class SingaporeCustomsConnector {
  source: any;
  pageUrl: string;

  constructor(source) {
    this.source = source;
    this.pageUrl =
      process.env.SINGAPORE_CUSTOMS_STATS_URL || "https://www.customs.gov.sg/businesses/trade-statistics/";
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
      const err: any = new Error(`Singapore Customs browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: {} };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `customs-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: "Singapore Customs Trade Statistics",
          url: finalUrl,
          content: {
            source: "singapore_customs",
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
