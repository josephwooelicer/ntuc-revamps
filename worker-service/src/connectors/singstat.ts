type PullRange = {
  start?: string;
  end?: string;
};

type PullFilters = Record<string, any>;

type ConnectorDocument = {
  externalId?: string | null;
  publishedAt?: string | null;
  title?: string | null;
  url?: string | null;
  content?: any;
};

type ConnectorPullResult = {
  documents: ConnectorDocument[];
  nextCursor: string | null;
};

const BASE_URL = "https://tablebuilder.singstat.gov.sg";
const FIND_APIS_URL = `${BASE_URL}/view-api/find-apis`;
const TABLE_INDEX_URL = `${BASE_URL}/api/doswebcontent/1/SubjectGrouping/getdataapi/?admin=false`;

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function parseJsonSafe(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  const out = String(value).replace(/\s+/g, " ").trim();
  return out.length ? out : null;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        process.env.CONNECTOR_BROWSER_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }
  });
  if (!res.ok) {
    throw new Error(`SingStat request failed (${res.status}): ${url}`);
  }
  return res.json();
}

async function fetchRowDataSeries(rowUuid: string, tableId: string, maxParts: number) {
  const parts: Array<{ part: string; url: string; payload: any }> = [];
  for (let idx = 1; idx <= maxParts; idx += 1) {
    const part = idx === 1 ? "1" : `1.${idx - 1}`;
    const url = `${BASE_URL}/rowdata/${rowUuid}_${tableId}_${part}.json`;
    const res = await fetch(url);
    if (res.status === 404) break;
    if (!res.ok) {
      throw new Error(`SingStat rowdata request failed (${res.status}): ${url}`);
    }
    const raw = await res.text();
    parts.push({
      part,
      url,
      payload: parseJsonSafe(raw)
    });
  }
  return parts;
}

export function createSingstatConnector() {
  return {
    async pull(_range: PullRange, _cursor: string | null, filters: PullFilters = {}): Promise<ConnectorPullResult> {
      const maxReports = Math.max(1, toInt(filters.maxReports, 667));
      const startPage = Math.max(1, toInt(filters.startPage, 1));
      const expectedPages = Math.max(1, toInt(filters.expectedPages, 14));
      const pageSize = Math.max(1, toInt(filters.pageSize, 50));
      const maxRowDataParts = Math.max(1, toInt(filters.maxRowDataParts, 50));

      const indexResponse = await fetchJson(TABLE_INDEX_URL);
      const indexRows = Array.isArray(indexResponse?.Data) ? indexResponse.Data : [];

      const selectedTableIds: string[] = Array.isArray(filters.tableIds)
        ? filters.tableIds.map((value: unknown) => String(value)).filter(Boolean)
        : [];
      const existingExternalIds = new Set(
        Array.isArray(filters.existingExternalIds)
          ? filters.existingExternalIds.map((value: unknown) => String(value))
          : []
      );

      const normalizedRows = indexRows
        .map((row: any) => ({
          tableId: normalizeText(row?.matrixNumber),
          title: normalizeText(row?.title),
          subjectGroupingName: normalizeText(row?.subjectGroupingName),
          subjectName: normalizeText(row?.subjectName),
          topicName: normalizeText(row?.topicName)
        }))
        .filter((row: any) => row.tableId);

      const rowsToDownload = selectedTableIds.length
        ? normalizedRows.filter((row: any) => selectedTableIds.includes(String(row.tableId)))
        : normalizedRows;

      const startIndex = Math.max(0, (startPage - 1) * pageSize);
      const pageScopedRows = rowsToDownload.slice(startIndex, expectedPages * pageSize);
      const unseenRows = pageScopedRows.filter((row: any) => !existingExternalIds.has(String(row.tableId)));
      const targetRows = unseenRows.slice(0, maxReports);

      const documents: ConnectorDocument[] = [];
      for (const row of targetRows) {
        const tableId = String(row.tableId);
        const metaUrl = `${BASE_URL}/api/doswebcontent/1/StatisticTableFileUpload/StatisticTable/${tableId}`;
        const meta = await fetchJson(metaUrl);
        const data = meta?.Data || {};
        const rowUuid = normalizeText(data?.id);

        const rowData = rowUuid ? await fetchRowDataSeries(rowUuid, tableId, maxRowDataParts) : [];

        documents.push({
          externalId: tableId,
          publishedAt: new Date().toISOString(),
          title: row.title || `SingStat table ${tableId}`,
          url: FIND_APIS_URL,
          content: {
            connector: "src-singstat",
            discoveredFrom: TABLE_INDEX_URL,
            discovery: {
              subjectGroupingName: row.subjectGroupingName,
              subjectName: row.subjectName,
              topicName: row.topicName,
              totalDiscoveredTables: normalizedRows.length,
              selectedCount: targetRows.length,
              startPage,
              expectedPages,
              pageSize
            },
            tableId,
            tableMetaUrl: metaUrl,
            tableMeta: data,
            rowData
          }
        });
      }

      return {
        documents,
        nextCursor: null
      };
    }
  };
}
