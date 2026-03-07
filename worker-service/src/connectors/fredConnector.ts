import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class FredConnector {
  source: any;
  baseUrl: string;

  constructor(source) {
    this.source = source;
    this.baseUrl = process.env.FRED_API_BASE_URL || "https://api.stlouisfed.org/fred/series/observations";
  }

  async pull(range, cursor = null, options: { seriesId?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const seriesId = options.seriesId || process.env.FRED_DEFAULT_SERIES_ID || "FEDFUNDS";
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      throw new Error("FRED connector requires FRED_API_KEY");
    }

    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: apiKey,
      file_type: "json"
    });
    const url = `${this.baseUrl}?${params.toString()}`;

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
        const err: any = new Error(`FRED API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { seriesId } };
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
          externalId: `fred-${seriesId}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `FRED series ${seriesId}`,
          url,
          content: {
            source: "fred",
            request: { method: "GET", url, headers: { Accept: "application/json" }, seriesId },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
