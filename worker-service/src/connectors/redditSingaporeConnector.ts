import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class RedditSingaporeConnector {
  source: any;

  constructor(source) {
    this.source = source;
  }

  async pull(range, cursor = null, options: { subreddit?: string; query?: string; limit?: number } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const subreddit = options.subreddit || process.env.REDDIT_DEFAULT_SUBREDDIT || "singapore";
    const query = options.query || process.env.REDDIT_DEFAULT_QUERY || "retrenchment OR layoffs";
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));

    const params = new URLSearchParams({
      q: query,
      restrict_sr: "1",
      sort: "new",
      t: "year",
      limit: String(limit)
    });
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?${params.toString()}`;

    const { signal, clear } = withTimeoutSignal(Number(process.env.CONNECTOR_HTTP_TIMEOUT_MS || 20000));
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let body: any;

    try {
      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal });
      responseStatus = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      if (!response.ok) {
        const responseText = await response.text();
        const err: any = new Error(`Reddit API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { subreddit, query, limit } };
        throw err;
      }
      body = await response.json();
    } finally {
      clear();
    }

    const fingerprint = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 12);
    return {
      documents: [
        {
          externalId: `reddit-${subreddit}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `Reddit ${subreddit} search`,
          url,
          content: {
            source: "reddit",
            request: { method: "GET", url, headers: { Accept: "application/json" }, subreddit, query, limit },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
