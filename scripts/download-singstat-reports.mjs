#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const FIND_APIS_BASE_URL =
  process.env.SINGSTAT_FIND_APIS_URL || "https://tablebuilder.singstat.gov.sg/view-api/find-apis";
const TABLE_DATA_BASE_URL =
  process.env.SINGSTAT_API_BASE_URL || "https://tablebuilder.singstat.gov.sg/api/table/tabledata";
const MAX_PAGES = Math.max(1, Number(process.env.SINGSTAT_FIND_APIS_MAX_PAGES || 20));
const OUTPUT_ROOT = process.env.SINGSTAT_DUMP_PATH || "./data-lake/raw/singstat";
const REPORTS_DIR = path.join(OUTPUT_ROOT, "reports");
const MANIFEST_PATH = path.join(OUTPUT_ROOT, "manifest.json");
const TIMEOUT_MS = Math.max(1000, Number(process.env.CONNECTOR_HTTP_TIMEOUT_MS || 20000));
const BROWSER_TIMEOUT_MS = Math.max(5000, Number(process.env.CONNECTOR_BROWSER_TIMEOUT_MS || 45000));
const FIND_APIS_DATA_API_PATTERN = "/api/doswebcontent/1/SubjectGrouping/getdataapi/";

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { generatedAt: null, source: FIND_APIS_BASE_URL, ids: {}, pagesScanned: 0 };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.ids || typeof parsed.ids !== "object") {
      return { generatedAt: null, source: FIND_APIS_BASE_URL, ids: {}, pagesScanned: 0 };
    }
    return parsed;
  } catch {
    return { generatedAt: null, source: FIND_APIS_BASE_URL, ids: {}, pagesScanned: 0 };
  }
}

function writeManifest(manifest) {
  manifest.generatedAt = new Date().toISOString();
  manifest.source = FIND_APIS_BASE_URL;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function normalizeUrlForPage(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page > 1) {
    url.searchParams.set("page", String(page));
  } else {
    url.searchParams.delete("page");
  }
  return url.toString();
}

async function scrapeFindApisData(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      process.env.CONNECTOR_BROWSER_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  try {
    const page = await context.newPage();
    let capturedJson = null;

    page.on("response", async (response) => {
      const responseUrl = response.url();
      if (!responseUrl.includes(FIND_APIS_DATA_API_PATTERN)) return;
      if (response.status() < 200 || response.status() >= 300) return;
      try {
        capturedJson = await response.json();
      } catch {
        // ignore parse failures, fallback below
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: BROWSER_TIMEOUT_MS }).catch(() => {});

    if (capturedJson) return capturedJson;

    // Fallback to explicit browser-session request if event capture misses.
    const apiUrl = new URL(FIND_APIS_DATA_API_PATTERN, "https://tablebuilder.singstat.gov.sg");
    apiUrl.searchParams.set("admin", "false");
    const apiResponse = await context.request.get(apiUrl.toString(), {
      headers: { Accept: "application/json" },
      timeout: BROWSER_TIMEOUT_MS
    });
    if (!apiResponse.ok()) {
      throw new Error(`Failed to load find-apis data feed: HTTP ${apiResponse.status()}`);
    }
    return await apiResponse.json();
  } finally {
    await context.close();
    await browser.close();
  }
}

async function fetchJson(url) {
  const { signal, clear } = withTimeoutSignal(TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clear();
  }
}

async function discoverAllTableIds() {
  const pageUrl = normalizeUrlForPage(FIND_APIS_BASE_URL, 1);
  process.stdout.write(`Scraping rendered data source from: ${pageUrl}\n`);
  const payload = await scrapeFindApisData(pageUrl);
  const rows = Array.isArray(payload?.Data) ? payload.Data : [];
  const allIds = new Set();

  for (const row of rows) {
    const candidate = String(row?.matrixNumber || row?.code || row?.id || "").trim();
    if (!candidate) continue;
    if (candidate.length < 3) continue;
    allIds.add(candidate);
  }

  // Keep metadata aligned with the UX pagination count where possible.
  const estimatedPages = Math.max(1, Math.ceil(rows.length / 50));
  return { ids: Array.from(allIds).sort(), pagesScanned: Math.min(MAX_PAGES, estimatedPages) };
}

async function downloadTableReport(tableId) {
  const url = `${TABLE_DATA_BASE_URL}/${encodeURIComponent(tableId)}`;
  const body = await fetchJson(url);
  const outputPath = path.join(REPORTS_DIR, `${tableId}.json`);
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        tableId,
        fetchedAt: new Date().toISOString(),
        url,
        body
      },
      null,
      2
    )
  );
}

async function main() {
  ensureDir(REPORTS_DIR);
  const manifest = readManifest();

  const discovered = await discoverAllTableIds();
  manifest.pagesScanned = discovered.pagesScanned;

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const tableId of discovered.ids) {
    const outputPath = path.join(REPORTS_DIR, `${tableId}.json`);
    const alreadyKnown = Boolean(manifest.ids?.[tableId]);
    if (alreadyKnown && fs.existsSync(outputPath)) {
      skipped += 1;
      continue;
    }

    process.stdout.write(`Downloading ${tableId}\n`);
    try {
      await downloadTableReport(tableId);
      manifest.ids[tableId] = {
        downloadedAt: new Date().toISOString(),
        path: path.relative(OUTPUT_ROOT, outputPath)
      };
      downloaded += 1;
    } catch (error) {
      failed += 1;
      manifest.ids[tableId] = {
        failedAt: new Date().toISOString(),
        error: String(error?.message || error)
      };
      process.stderr.write(`Failed ${tableId}: ${String(error?.message || error)}\n`);
    }
  }

  writeManifest(manifest);
  process.stdout.write(
    `Done. discovered=${discovered.ids.length} downloaded=${downloaded} skipped=${skipped} failed=${failed}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
