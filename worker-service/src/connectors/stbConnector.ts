import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class StbConnector {
  source: any;
  dataUrl: string;

  constructor(source) {
    this.source = source;
    this.dataUrl = process.env.STB_STATS_URL || "https://www.stb.gov.sg/content/stb/en/statistics-and-market-insights.html";
  }

  async pull(range, cursor = null, _options = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const url = this.dataUrl;
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
      const err: any = new Error(`STB browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: {} };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `stb-stats-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: "STB Statistics and Insights",
          url: finalUrl,
          content: {
            source: "stb",
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
