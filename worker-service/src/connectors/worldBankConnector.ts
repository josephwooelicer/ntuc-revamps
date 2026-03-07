import { createHash } from "node:crypto";

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class WorldBankConnector {
  source: any;
  baseUrl: string;

  constructor(source) {
    this.source = source;
    this.baseUrl = process.env.WORLDBANK_API_BASE_URL || "https://api.worldbank.org/v2/country/SGP/indicator";
  }

  async pull(range, cursor = null, options: { indicator?: string } = {}) {
    if (cursor) return { documents: [], nextCursor: null };
    const indicator = options.indicator || process.env.WORLDBANK_DEFAULT_INDICATOR || "FP.CPI.TOTL.ZG";
    const url = `${this.baseUrl}/${encodeURIComponent(indicator)}?format=json&per_page=200`;

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
        const err: any = new Error(`World Bank API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { indicator } };
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
          externalId: `worldbank-${indicator}-${fingerprint}`,
          publishedAt: new Date(range?.end || range?.start || Date.now()).toISOString(),
          title: `World Bank indicator ${indicator}`,
          url,
          content: {
            source: "world_bank",
            request: { method: "GET", url, headers: { Accept: "application/json" }, indicator },
            response: { status: responseStatus, headers: responseHeaders, body },
            fetchedAt: new Date().toISOString()
          }
        }
      ],
      nextCursor: null
    };
  }
}
