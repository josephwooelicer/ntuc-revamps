import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class HardwarezoneConnector {
  source: any;
  scrapeBaseUrl: string;

  constructor(source) {
    this.source = source;
    this.scrapeBaseUrl = process.env.HARDWAREZONE_SCRAPE_BASE_URL || "https://forums.hardwarezone.com.sg";
  }

  async pull(range, cursor = null, options: { query?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const query = options.query || process.env.HARDWAREZONE_DEFAULT_QUERY || "retrenchment";

    const url = `${this.scrapeBaseUrl}/search/?${new URLSearchParams({ q: query }).toString()}`;
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let html = "";
    let finalUrl = url;
    try {
      const scraped = await scrapePageWithBrowser(url);
      responseStatus = scraped.status;
      responseHeaders = scraped.headers;
      html = scraped.html;
      finalUrl = scraped.finalUrl;
      if (responseStatus >= 400) {
        const err: any = new Error(`HardwareZone scrape request failed with status ${responseStatus}`);
        err.status = responseStatus;
        err.responseText = html;
        err.request = { method: "GET", url, finalUrl, params: { query } };
        throw err;
      }
    } catch (error: any) {
      if (error?.status) throw error;
      const err: any = new Error(`HardwareZone browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: { query } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(html).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `hardwarezone-${query}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `HardwareZone query: ${query}`,
          url: finalUrl,
          content: {
            source: "hardwarezone",
            request: { method: "GET", url, finalUrl, mode: "browser", query },
            response: { status: responseStatus, headers: responseHeaders, body: html },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
