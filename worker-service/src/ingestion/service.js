import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveRepoPath } from "../lib/paths.js";
import { connectorForSource, getSourceById } from "./sourceRegistry.js";

const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";

function buildObjectKey(sourceId, runId, publishedAt, externalId) {
  const day = (publishedAt || new Date().toISOString()).slice(0, 10);
  const safeExternalId = String(externalId || randomUUID()).replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(rawPath, sourceId, day, runId, `${safeExternalId}.json`);
}

function persistRawDocument({ runId, sourceId, doc }) {
  const objectKey = buildObjectKey(sourceId, runId, doc.publishedAt, doc.externalId);
  const absolutePath = resolveRepoPath(objectKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const payload = {
    sourceId,
    externalId: doc.externalId || null,
    publishedAt: doc.publishedAt || null,
    title: doc.title || null,
    url: doc.url || null,
    content: doc.content || null,
    fetchedAt: new Date().toISOString()
  };
  const content = JSON.stringify(payload, null, 2);
  fs.writeFileSync(absolutePath, content);

  return {
    objectKey,
    contentHash: createHash("sha256").update(content).digest("hex")
  };
}

function insertIngestionRun(db, sourceId, runType, rangeStart, rangeEnd) {
  const runId = randomUUID();
  db
    .prepare(
      `INSERT INTO ingestion_run (id, source_id, run_type, range_start, range_end, status)
       VALUES (?, ?, ?, ?, ?, 'running')`
    )
    .run(runId, sourceId, runType, rangeStart || null, rangeEnd || null);
  return runId;
}

function finalizeIngestionRun(db, runId, status) {
  db.prepare("UPDATE ingestion_run SET status = ?, ended_at = current_timestamp WHERE id = ?").run(status, runId);
}

function getIngestionRun(db, runId) {
  const run = db.prepare("SELECT * FROM ingestion_run WHERE id = ?").get(runId);
  if (!run) return null;
  const docs = db
    .prepare(
      `SELECT id, external_id, published_at, title, url, object_key
       FROM raw_document
       WHERE ingestion_run_id = ?
       ORDER BY fetched_at`
    )
    .all(runId);
  return { ...run, raw_documents: docs, raw_document_count: docs.length };
}

export function runIngestion(db, input) {
  const { sourceId, runType, rangeStart, rangeEnd, cursor = null } = input;
  if (!sourceId || !runType) {
    throw new Error("Missing required fields: sourceId, runType");
  }

  const source = getSourceById(db, sourceId);
  if (!source) {
    throw new Error("source not found");
  }
  if (!source.is_active) {
    throw new Error("source is not active");
  }

  const connector = connectorForSource(source);
  if (!connector) {
    throw new Error(`No connector registered for source: ${sourceId}`);
  }

  const runId = insertIngestionRun(db, sourceId, runType, rangeStart, rangeEnd);

  const items = [];
  let nextCursorValue = cursor;
  try {
    do {
      const loaded = connector.pull({ start: rangeStart, end: rangeEnd }, nextCursorValue);
      items.push(...(loaded.documents || []));
      nextCursorValue = loaded.nextCursor;
    } while (nextCursorValue);
  } catch (error) {
    finalizeIngestionRun(db, runId, "failed");
    throw error;
  }

  db.exec("BEGIN;");
  try {
    for (const doc of items) {
      const { objectKey, contentHash } = persistRawDocument({
        runId,
        sourceId,
        doc
      });
      db
        .prepare(
          `INSERT INTO raw_document (
             id, ingestion_run_id, source_id, external_id, published_at, title, url, object_key, content_hash, pii_masked
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          randomUUID(),
          runId,
          sourceId,
          doc.externalId || null,
          doc.publishedAt || null,
          doc.title || null,
          doc.url || null,
          objectKey,
          contentHash
        );
    }

    finalizeIngestionRun(db, runId, "success");
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    finalizeIngestionRun(db, runId, "failed");
    throw error;
  }

  return {
    run: getIngestionRun(db, runId),
    source: {
      id: source.id,
      name: source.name,
      category: source.category,
      reliabilityWeight: source.reliability_weight
    }
  };
}

export function runBackfillNews(db, input) {
  const { sourceId, rangeStart, rangeEnd } = input;
  if (!sourceId || !rangeStart || !rangeEnd) {
    throw new Error("Missing required fields: sourceId, rangeStart, rangeEnd");
  }

  const source = getSourceById(db, sourceId);
  if (!source) {
    throw new Error("source not found");
  }
  if (source.source_type !== "news") {
    throw new Error("Backfill endpoint only supports news sources");
  }
  if (!source.supports_backfill) {
    throw new Error("source does not support backfill");
  }

  return runIngestion(db, {
    sourceId,
    runType: "backfill",
    rangeStart,
    rangeEnd
  });
}

export function fetchIngestionRun(db, runId) {
  const run = getIngestionRun(db, runId);
  if (!run) {
    throw new Error("ingestion_run not found");
  }
  return run;
}
