import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { resolveRepoPath } from "../lib/paths.js";

const TREND_KEYWORDS = [
  "rising",
  "increase",
  "increasing",
  "sustained",
  "slowdown",
  "slower",
  "decline",
  "declining",
  "weaker",
  "pressure",
  "margin",
  "soften",
  "softening",
  "defer",
  "deferral"
];

const EVENT_KEYWORDS = [
  "retrench",
  "layoff",
  "cuts",
  "closure",
  "shutdown",
  "winding up",
  "insolvency",
  "bankruptcy",
  "default",
  "resignation",
  "probe",
  "investigation",
  "strike",
  "suspension",
  "freeze"
];

const NEGATIVE_KEYWORDS = [
  "pressure",
  "weaker",
  "loss",
  "deficit",
  "drop",
  "slower",
  "slowdown",
  "decline",
  "cost",
  "rent",
  "retrench",
  "layoff",
  "defer",
  "default"
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countKeywords(text, keywords) {
  if (!text) return 0;
  let count = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      count += 1;
    }
  }
  return count;
}

function inferIndustryId(text) {
  if (!text) return null;

  const fnbTerms = ["f&b", "food", "beverage", "restaurant", "rental", "retail", "dining"];
  const techTerms = ["tech", "software", "digital", "engineering", "hiring", "developer"];

  const fnbHits = countKeywords(text, fnbTerms);
  const techHits = countKeywords(text, techTerms);

  if (fnbHits === 0 && techHits === 0) return null;
  return fnbHits >= techHits ? "ind-fnb" : "ind-tech";
}

function extractorTypeForSource(source) {
  if (source.source_type === "gov") return "official_stats_extractor";
  if (source.source_type === "news") return "news_events_extractor";
  if (source.source_type === "forum") return "forums_social_extractor";
  if (source.category === "registry_compliance") return "registry_filings_extractor";
  if (source.category === "job_market") return "job_market_extractor";
  if (source.category === "reviews_maps") return "reviews_maps_extractor";
  return "news_events_extractor";
}

function parseRawPayload(rawDocument) {
  const absolutePath = resolveRepoPath(rawDocument.object_key);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Raw document object not found: ${rawDocument.object_key}`);
  }

  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const title = payload.title || rawDocument.title || "";
  const content = payload.content || "";
  const publishedAt = payload.publishedAt || rawDocument.published_at || rawDocument.fetched_at;

  return {
    title,
    content,
    publishedAt,
    text: normalizeText(`${title} ${content}`)
  };
}

function monthsAgoIso(months, referenceIso) {
  const reference = new Date(referenceIso || new Date().toISOString());
  reference.setUTCMonth(reference.getUTCMonth() - months);
  return reference.toISOString();
}

function computeZScore(values, target) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (target - mean) / sd;
}

function getBaselineValues(db, signal, baselineMonths) {
  const start = monthsAgoIso(baselineMonths, signal.signalTs);

  if (signal.companyId) {
    return db
      .prepare(
        `SELECT raw_value
         FROM signal
         WHERE company_id = ?
           AND signal_type = ?
           AND category = ?
           AND signal_ts >= ?
           AND raw_value IS NOT NULL`
      )
      .all(signal.companyId, signal.signalType, signal.category, start)
      .map((row) => Number(row.raw_value))
      .filter((value) => Number.isFinite(value));
  }

  return db
    .prepare(
      `SELECT raw_value
       FROM signal
       WHERE industry_id = ?
         AND company_id IS NULL
         AND signal_type = ?
         AND category = ?
         AND signal_ts >= ?
         AND raw_value IS NOT NULL`
    )
    .all(signal.industryId, signal.signalType, signal.category, start)
    .map((row) => Number(row.raw_value))
    .filter((value) => Number.isFinite(value));
}

function getDecayWeight(db, signalTs, isIndustrySignal) {
  const enabledRow = db.prepare("SELECT value FROM config_item WHERE key = 'time_decay_enabled'").get();
  const enabled = String(enabledRow?.value || "true").toLowerCase() === "true";
  if (!enabled) return 1;

  const weightsRow = db.prepare("SELECT value FROM config_item WHERE key = 'time_decay_weights'").get();
  let weeklyWeight = 0.7;
  let monthlyWeight = 0.3;

  try {
    const parsed = JSON.parse(weightsRow?.value || "{}");
    if (Number.isFinite(parsed.weekly)) weeklyWeight = Number(parsed.weekly);
    if (Number.isFinite(parsed.monthly)) monthlyWeight = Number(parsed.monthly);
  } catch {
    // keep defaults
  }

  const nowMs = Date.now();
  const signalMs = new Date(signalTs).getTime();
  const ageDays = Number.isFinite(signalMs) ? Math.max(0, (nowMs - signalMs) / (1000 * 60 * 60 * 24)) : 0;

  const base = isIndustrySignal ? monthlyWeight : weeklyWeight;
  const periods = isIndustrySignal ? ageDays / 30 : ageDays / 7;
  const weighted = Math.pow(Math.max(0.01, Math.min(base, 1)), periods);

  return Math.max(0.05, Math.min(1, weighted));
}

function buildSignalsFromText(context) {
  const trendHits = countKeywords(context.text, TREND_KEYWORDS);
  const eventHits = countKeywords(context.text, EVENT_KEYWORDS);
  const negativeHits = countKeywords(context.text, NEGATIVE_KEYWORDS);

  const trendRaw = trendHits * 1.5 + negativeHits * 0.8;
  const eventRaw = eventHits * 2.2 + negativeHits * 0.5;

  const output = [];
  if (trendRaw > 0) {
    output.push({ signalType: "trend", rawValue: Number(trendRaw.toFixed(4)) });
  }
  if (eventRaw > 0) {
    output.push({ signalType: "event", rawValue: Number(eventRaw.toFixed(4)) });
  }

  return output;
}

function loadRawDocumentsForRun(db, ingestionRunId) {
  const run = db
    .prepare("SELECT id, source_id, status FROM ingestion_run WHERE id = ?")
    .get(ingestionRunId);

  if (!run) {
    throw new Error("ingestion_run not found");
  }
  if (run.status !== "success") {
    throw new Error("ingestion_run must be in success state before signal processing");
  }

  const docs = db
    .prepare(
      `SELECT rd.id, rd.source_id, rd.title, rd.object_key, rd.published_at, rd.fetched_at, rd.url,
              ds.category, ds.source_type, ds.reliability_weight,
              er.status AS resolution_status, er.matched_company_id,
              c.industry_id AS company_industry_id
       FROM raw_document rd
       JOIN data_source ds ON ds.id = rd.source_id
       LEFT JOIN entity_resolution er ON er.raw_document_id = rd.id
       LEFT JOIN company c ON c.id = er.matched_company_id
       WHERE rd.ingestion_run_id = ?
       ORDER BY rd.fetched_at ASC`
    )
    .all(ingestionRunId);

  return { run, docs };
}

function clearExistingSignalsForDocuments(db, rawDocumentIds) {
  if (!rawDocumentIds.length) return;

  const placeholders = rawDocumentIds.map(() => "?").join(",");
  const signalRows = db
    .prepare(
      `SELECT DISTINCT signal_id
       FROM evidence_pointer
       WHERE raw_document_id IN (${placeholders})`
    )
    .all(...rawDocumentIds);

  db.prepare(`DELETE FROM evidence_pointer WHERE raw_document_id IN (${placeholders})`).run(...rawDocumentIds);

  if (!signalRows.length) return;

  const signalIds = signalRows.map((row) => row.signal_id).filter(Boolean);
  if (!signalIds.length) return;

  const signalPlaceholders = signalIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM signal WHERE id IN (${signalPlaceholders})`).run(...signalIds);
}

export function processSignals(db, input) {
  const { ingestionRunId } = input;
  if (!ingestionRunId) {
    throw new Error("Missing required field: ingestionRunId");
  }

  const { docs } = loadRawDocumentsForRun(db, ingestionRunId);
  if (!docs.length) {
    return {
      ingestionRunId,
      processedRawDocuments: 0,
      generatedSignals: 0,
      generatedEvidencePointers: 0,
      byType: { trend: 0, event: 0 }
    };
  }

  const companyBaselineMonths = Number(
    db.prepare("SELECT value FROM config_item WHERE key = 'company_baseline_months'").get()?.value || 12
  );
  const industryBaselineMonths = Number(
    db.prepare("SELECT value FROM config_item WHERE key = 'industry_baseline_months'").get()?.value || 24
  );

  let generatedSignals = 0;
  let generatedEvidencePointers = 0;
  const byType = { trend: 0, event: 0 };

  db.exec("BEGIN;");
  try {
    clearExistingSignalsForDocuments(
      db,
      docs.map((doc) => doc.id)
    );

    for (const doc of docs) {
      const parsed = parseRawPayload(doc);
      const resolvedIndustryId = doc.company_industry_id || inferIndustryId(parsed.text);
      const companyId =
        doc.matched_company_id && ["auto_resolved", "approved"].includes(String(doc.resolution_status || ""))
          ? doc.matched_company_id
          : null;

      if (!resolvedIndustryId) {
        continue;
      }

      const extractorType = extractorTypeForSource(doc);
      const category = doc.category || "general";
      const derivedSignals = buildSignalsFromText(parsed);

      for (const candidate of derivedSignals) {
        const signalContext = {
          companyId,
          industryId: resolvedIndustryId,
          signalType: candidate.signalType,
          category,
          signalTs: parsed.publishedAt
        };

        const baselineValues = getBaselineValues(
          db,
          signalContext,
          companyId ? companyBaselineMonths : industryBaselineMonths
        );
        const zValue = computeZScore(baselineValues, candidate.rawValue);
        const reliabilityWeight = Number(doc.reliability_weight || 0.7);
        const decayWeight = getDecayWeight(db, parsed.publishedAt, !companyId);
        const weightedValue = Number((zValue * reliabilityWeight * decayWeight).toFixed(6));

        const signalId = randomUUID();
        db
          .prepare(
            `INSERT INTO signal (
              id, company_id, industry_id, source_id, signal_type, category, signal_ts,
              raw_value, z_value, reliability_weight, decay_weight, weighted_value, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            signalId,
            companyId,
            resolvedIndustryId,
            doc.source_id,
            candidate.signalType,
            category,
            parsed.publishedAt,
            candidate.rawValue,
            Number(zValue.toFixed(6)),
            reliabilityWeight,
            Number(decayWeight.toFixed(6)),
            weightedValue,
            0.85
          );

        const snippet = `${parsed.title}. ${parsed.content}`.slice(0, 400);
        db
          .prepare(
            `INSERT INTO evidence_pointer (
              id, signal_id, raw_document_id, snippet, pointer_url
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), signalId, doc.id, snippet, doc.url || null);

        generatedSignals += 1;
        generatedEvidencePointers += 1;
        byType[candidate.signalType] += 1;
      }

      // Persist extraction pass as audit trace for replay/debugging.
      db
        .prepare(
          `INSERT INTO audit_log (
            id, actor_user_id, action, entity_type, entity_id, before_state, after_state
          ) VALUES (?, NULL, 'signal_processing.document_processed', 'raw_document', ?, NULL, ?)`
        )
        .run(
          randomUUID(),
          doc.id,
          JSON.stringify({ extractorType, category, industryId: resolvedIndustryId, companyId })
        );
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    ingestionRunId,
    processedRawDocuments: docs.length,
    generatedSignals,
    generatedEvidencePointers,
    byType
  };
}

export function listCompanySignals(db, companyId, query) {
  const clauses = ["s.company_id = ?"];
  const params = [companyId];

  if (query.start) {
    clauses.push("s.signal_ts >= ?");
    params.push(query.start);
  }
  if (query.end) {
    clauses.push("s.signal_ts <= ?");
    params.push(query.end);
  }
  if (query.category) {
    clauses.push("s.category = ?");
    params.push(query.category);
  }
  if (query.type) {
    clauses.push("s.signal_type = ?");
    params.push(query.type);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT s.id, s.company_id, s.industry_id, s.source_id, s.signal_type, s.category, s.signal_ts,
              s.raw_value, s.z_value, s.reliability_weight, s.decay_weight, s.weighted_value, s.confidence,
              ep.id AS evidence_id, ep.snippet, ep.pointer_url, ep.raw_document_id
       FROM signal s
       LEFT JOIN evidence_pointer ep ON ep.signal_id = s.id
       ${where}
       ORDER BY s.signal_ts DESC`
    )
    .all(...params);

  return { data: rows, count: rows.length };
}

export function listIndustrySignals(db, industryId, query) {
  const clauses = ["s.industry_id = ?"];
  const params = [industryId];

  if (query.start) {
    clauses.push("s.signal_ts >= ?");
    params.push(query.start);
  }
  if (query.end) {
    clauses.push("s.signal_ts <= ?");
    params.push(query.end);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;

  const rows = db
    .prepare(
      `SELECT s.id, s.company_id, s.industry_id, s.source_id, s.signal_type, s.category, s.signal_ts,
              s.raw_value, s.z_value, s.reliability_weight, s.decay_weight, s.weighted_value, s.confidence,
              ep.id AS evidence_id, ep.snippet, ep.pointer_url, ep.raw_document_id
       FROM signal s
       LEFT JOIN evidence_pointer ep ON ep.signal_id = s.id
       ${where}
       ORDER BY s.signal_ts DESC`
    )
    .all(...params);

  return { data: rows, count: rows.length };
}
