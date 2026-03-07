import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class AcraConnector {
  source: any;
  apiBaseUrl: string;

  constructor(source) {
    this.source = source;
    this.apiBaseUrl = process.env.ACRA_API_BASE_URL || "https://api.data.gov.sg/v1/public/api/datasets";
  }

  async pull(range, cursor = null, options: { uen?: string; entityName?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };

    const uen = options.uen || process.env.ACRA_DEFAULT_UEN || "";
    const entityName = options.entityName || "";
    if (!uen && !entityName) {
      throw new Error("ACRA connector requires company identifier: filters.uen or filters.entityName");
    }

    const query = new URLSearchParams();
    if (uen) query.set("uen", uen);
    if (entityName) query.set("q", entityName);
    const url = `${this.apiBaseUrl}?${query.toString()}`;

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
        const err: any = new Error(`ACRA API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { uen, entityName } };
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
          externalId: `acra-${uen || entityName}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `ACRA lookup ${uen || entityName}`,
          url,
          content: {
            source: "acra",
            request: { method: "GET", url, headers: { Accept: "application/json" }, uen, entityName },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
