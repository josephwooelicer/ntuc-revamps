import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class GoogleMapsConnector {
  source: any;
  apiUrl: string;

  constructor(source) {
    this.source = source;
    this.apiUrl = process.env.GOOGLE_PLACES_TEXTSEARCH_URL || "https://maps.googleapis.com/maps/api/place/textsearch/json";
  }

  async pull(range, cursor = null, options: { query?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new Error("Google Maps connector requires GOOGLE_MAPS_API_KEY");
    }
    const query = options.query || process.env.GOOGLE_MAPS_DEFAULT_QUERY || "Singapore restaurants";
    const params = new URLSearchParams({ query, key: apiKey });
    const url = `${this.apiUrl}?${params.toString()}`;

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
        const err: any = new Error(`Google Maps API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { query } };
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
          externalId: `google-maps-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `Google Maps query: ${query}`,
          url,
          content: {
            source: "google_maps",
            request: { method: "GET", url, headers: { Accept: "application/json" }, query },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
