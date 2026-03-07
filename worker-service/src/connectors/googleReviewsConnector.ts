import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class GoogleReviewsConnector {
  source: any;
  detailsUrl: string;

  constructor(source) {
    this.source = source;
    this.detailsUrl = process.env.GOOGLE_PLACE_DETAILS_URL || "https://maps.googleapis.com/maps/api/place/details/json";
  }

  async pull(range, cursor = null, options: { placeId?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error("Google Reviews connector requires GOOGLE_MAPS_API_KEY");

    const placeId = options.placeId || process.env.GOOGLE_REVIEWS_DEFAULT_PLACE_ID;
    if (!placeId) throw new Error("Google Reviews connector requires filters.placeId or GOOGLE_REVIEWS_DEFAULT_PLACE_ID");

    const params = new URLSearchParams({ place_id: placeId, fields: "name,rating,reviews", key: apiKey });
    const url = `${this.detailsUrl}?${params.toString()}`;

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
        const err: any = new Error(`Google Reviews API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { placeId } };
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
          externalId: `google-reviews-${placeId}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `Google Reviews place ${placeId}`,
          url,
          content: {
            source: "google_reviews",
            request: { method: "GET", url, headers: { Accept: "application/json" }, placeId },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
