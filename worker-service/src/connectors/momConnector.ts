import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class MomConnector {
  source: any;
  baseUrl: string;

  constructor(source) {
    this.source = source;
    this.baseUrl = process.env.MOM_DATA_API_BASE_URL || "https://data.gov.sg/api/action/datastore_search";
  }

  async pull(
    range,
    cursor = null,
    options: {
      resourceId?: string;
      datasetId?: string;
      limit?: number;
    } = {}
  ) {
    if (cursor) {
      return { documents: [], nextCursor: null };
    }

    const resourceId =
      options.resourceId ||
      options.datasetId ||
      process.env.MOM_DEFAULT_RESOURCE_ID ||
      "d_a8993aefcea515e2ac68b9ded46aa62d";

    const limit = Math.max(1, Math.min(Number(options.limit || 1000), 10000));
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(limit)
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    const timeoutMs = Number(process.env.CONNECTOR_HTTP_TIMEOUT_MS || 20000);
    const { signal, clear } = withTimeoutSignal(timeoutMs);

    let body: any;
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal
      });
      responseStatus = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      if (!response.ok) {
        const responseText = await response.text();
        const err: any = new Error(`MOM API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { resourceId, limit } };
        throw err;
      }
      body = await response.json();
      if (!body?.success) {
        throw new Error("MOM API response indicates failure");
      }
    } finally {
      clear();
    }

    const payload = JSON.stringify(body?.result || body);
    const fingerprint = createHash("sha1").update(payload).digest("hex").slice(0, 12);
    const publishedAt = range?.end || range?.start || new Date().toISOString();

    return {
      documents: [
        {
          externalId: `mom-${resourceId}-${fingerprint}`,
          publishedAt: new Date(publishedAt).toISOString(),
          title: `MOM dataset ${resourceId}`,
          url,
          content: {
            source: "mom",
            request: {
              method: "GET",
              url,
              headers: { Accept: "application/json" },
              resourceId,
              limit
            },
            response: {
              status: responseStatus,
              headers: responseHeaders,
              body
            },
            responseBodyHash: fingerprint,
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
