import { createHash } from "node:crypto";
import { scrapePageWithBrowser } from "../lib/browserScraper.js";

export class LinkedinJobsConnector {
  source: any;
  searchUrl: string;

  constructor(source) {
    this.source = source;
    this.searchUrl = process.env.LINKEDIN_JOBS_SEARCH_URL || "https://www.linkedin.com/jobs/search";
  }

  async pull(range, cursor = null, options: { keywords?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const keywords = options.keywords || process.env.LINKEDIN_JOBS_DEFAULT_KEYWORDS || "software engineer";
    const url = `${this.searchUrl}?${new URLSearchParams({ keywords, location: "Singapore" }).toString()}`;

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
        const err: any = new Error(`LinkedIn Jobs request failed with status ${responseStatus}`);
        err.status = responseStatus;
        err.responseText = body;
        err.request = { method: "GET", url, finalUrl, params: { keywords } };
        throw err;
      }
    } catch (error: any) {
      if (error?.status) throw error;
      const err: any = new Error(`LinkedIn Jobs browser scrape failed: ${error?.message || "unknown error"}`);
      err.status = 502;
      err.responseText = "";
      err.request = { method: "GET", url, finalUrl, params: { keywords } };
      throw err;
    }

    const fingerprint = createHash("sha1").update(body).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `linkedin-jobs-${keywords}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `LinkedIn Jobs search: ${keywords}`,
          url: finalUrl,
          content: {
            source: "linkedin_jobs",
            request: { method: "GET", url, finalUrl, mode: "browser", keywords },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
