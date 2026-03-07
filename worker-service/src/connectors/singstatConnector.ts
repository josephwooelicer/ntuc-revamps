import { createHash } from "node:crypto";

function toYearMonth(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export class SingstatConnector {
  source: any;
  baseUrl: string;

  constructor(source) {
    this.source = source;
    this.baseUrl =
      process.env.SINGSTAT_API_BASE_URL || "https://tablebuilder.singstat.gov.sg/api/table/tabledata";
  }

  async pull(
    range,
    cursor = null,
    options: { tableId?: string; startPeriod?: string; endPeriod?: string; timeFilter?: string } = {}
  ) {
    if (cursor) {
      return { documents: [], nextCursor: null };
    }

    const tableId = options.tableId || process.env.SINGSTAT_DEFAULT_TABLE_ID || "M212261";

    const startPeriod = options.startPeriod || toYearMonth(range?.start);
    const endPeriod = options.endPeriod || toYearMonth(range?.end);

    const params = new URLSearchParams();
    if (startPeriod) params.set("startPeriod", startPeriod);
    if (endPeriod) params.set("endPeriod", endPeriod);
    if (options.timeFilter) params.set("timeFilter", String(options.timeFilter));

    const url = `${this.baseUrl}/${encodeURIComponent(tableId)}${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    const timeoutMs = Number(process.env.CONNECTOR_HTTP_TIMEOUT_MS || 20000);
    const { signal, clear } = withTimeoutSignal(timeoutMs);

    let body;
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
        const err: any = new Error(`SingStat API request failed with status ${response.status}`);
        err.status = response.status;
        err.responseText = responseText;
        err.request = { method: "GET", url, params: { tableId, startPeriod, endPeriod } };
        throw err;
      }
      body = await response.json();
    } finally {
      clear();
    }

    const payload = JSON.stringify(body);
    const rangeLabel = `${startPeriod || "na"}_${endPeriod || "na"}`;
    const fingerprint = createHash("sha1").update(payload).digest("hex").slice(0, 12);

    return {
      documents: [
        {
          externalId: `singstat-${tableId}-${rangeLabel}-${fingerprint}`,
          publishedAt: new Date().toISOString(),
          title: `SingStat table ${tableId}`,
          url,
          content: {
            source: "singstat",
            request: {
              method: "GET",
              url,
              headers: {
                Accept: "application/json"
              },
              tableId,
              startPeriod,
              endPeriod
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
