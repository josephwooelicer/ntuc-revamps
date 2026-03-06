import { randomUUID } from "node:crypto";

const SGT_TIMEZONE = "Asia/Singapore";

function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function asNumberConfig(db, key, fallback) {
  const row = db.prepare("SELECT value FROM config_item WHERE key = ?").get(key);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSgtDateIso(input) {
  const date = input ? new Date(input) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SGT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

function previousDateIso(dateIso) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function previousWeekDateIso(dateIso) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function previousMonthStartIso(dateIso) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function latestCompanyFinalScores(db, briefDate) {
  return db
    .prepare(
      `SELECT ss.id, ss.company_id, ss.industry_id, ss.score_date, ss.score_value,
              c.registered_name, c.uen, i.code AS industry_code, i.name AS industry_name
       FROM score_snapshot ss
       JOIN company c ON c.id = ss.company_id
       LEFT JOIN industry i ON i.id = ss.industry_id
       WHERE ss.score_type = 'final'
         AND ss.period_type = 'weekly'
         AND ss.score_date = (
           SELECT MAX(inner_ss.score_date)
           FROM score_snapshot inner_ss
           WHERE inner_ss.score_type = 'final'
             AND inner_ss.period_type = 'weekly'
             AND inner_ss.company_id = ss.company_id
             AND inner_ss.score_date <= ?
         )
       ORDER BY ss.score_value DESC, ss.score_date DESC`
    )
    .all(briefDate);
}

function latestIndustryScores(db, briefDate) {
  return db
    .prepare(
      `SELECT ss.id, ss.industry_id, ss.score_date, ss.score_value, i.code, i.name
       FROM score_snapshot ss
       JOIN industry i ON i.id = ss.industry_id
       WHERE ss.score_type = 'industry'
         AND ss.period_type = 'monthly'
         AND ss.company_id IS NULL
         AND ss.score_date = (
           SELECT MAX(inner_ss.score_date)
           FROM score_snapshot inner_ss
           WHERE inner_ss.score_type = 'industry'
             AND inner_ss.period_type = 'monthly'
             AND inner_ss.industry_id = ss.industry_id
             AND inner_ss.score_date <= ?
         )
       ORDER BY ss.score_value DESC, ss.score_date DESC`
    )
    .all(briefDate);
}

function buildMajorEvents(db, briefDate) {
  const startDate = previousDateIso(briefDate);
  return db
    .prepare(
      `SELECT s.id AS signal_id, s.signal_ts, s.weighted_value, s.confidence, s.company_id, s.industry_id,
              c.registered_name, i.code AS industry_code, i.name AS industry_name,
              ep.pointer_url, ep.snippet, rd.url AS source_url, rd.title AS source_title
       FROM signal s
       LEFT JOIN company c ON c.id = s.company_id
       LEFT JOIN industry i ON i.id = s.industry_id
       LEFT JOIN evidence_pointer ep ON ep.signal_id = s.id
       LEFT JOIN raw_document rd ON rd.id = ep.raw_document_id
       WHERE s.signal_type = 'event'
         AND date(s.signal_ts) >= date(?)
         AND date(s.signal_ts) <= date(?)
       ORDER BY s.weighted_value DESC, s.signal_ts DESC
       LIMIT 25`
    )
    .all(startDate, briefDate)
    .map((row) => ({
      signalId: row.signal_id,
      signalTs: row.signal_ts,
      weightedValue: Number(Number(row.weighted_value || 0).toFixed(4)),
      confidence: Number(Number(row.confidence || 0).toFixed(4)),
      companyId: row.company_id || null,
      companyName: row.registered_name || null,
      industryId: row.industry_id || null,
      industryCode: row.industry_code || null,
      industryName: row.industry_name || null,
      evidence: {
        pointerUrl: row.pointer_url || null,
        snippet: row.snippet || null,
        sourceUrl: row.source_url || null,
        sourceTitle: row.source_title || null
      }
    }));
}

function scoreByCompanyForDate(db, dateIso) {
  return db
    .prepare(
      `SELECT company_id, score_value
       FROM score_snapshot
       WHERE score_type = 'final'
         AND period_type = 'weekly'
         AND score_date = (
           SELECT MAX(inner_ss.score_date)
           FROM score_snapshot inner_ss
           WHERE inner_ss.score_type = 'final'
             AND inner_ss.period_type = 'weekly'
             AND inner_ss.company_id = score_snapshot.company_id
             AND inner_ss.score_date <= ?
         )`
    )
    .all(dateIso);
}

export function generateMorningBrief(db, input) {
  const briefDate = toSgtDateIso(input?.briefDate);
  const highRiskThreshold = asNumberConfig(db, "high_risk_alert_threshold", 70);
  const industryStressGate = asNumberConfig(db, "industry_stress_gate_threshold", 60);
  const emergingDelta = asNumberConfig(db, "emerging_risk_delta_threshold", 10);
  const emergingCeiling = asNumberConfig(db, "emerging_risk_score_ceiling", 70);

  const companyRows = latestCompanyFinalScores(db, briefDate);
  const industryRows = latestIndustryScores(db, briefDate);
  const majorEvents = buildMajorEvents(db, briefDate);

  const highRiskCompanies = companyRows
    .filter((row) => Number(row.score_value) >= highRiskThreshold)
    .map((row) => ({
      companyId: row.company_id,
      uen: row.uen,
      companyName: row.registered_name,
      industryId: row.industry_id || null,
      industryCode: row.industry_code || null,
      industryName: row.industry_name || null,
      scoreDate: row.score_date,
      finalScore: Number(Number(row.score_value).toFixed(2))
    }));

  const stressedIndustries = industryRows
    .filter((row) => Number(row.score_value) >= industryStressGate)
    .map((row) => ({
      industryId: row.industry_id,
      code: row.code,
      name: row.name,
      scoreDate: row.score_date,
      industryRiskScore: Number(Number(row.score_value).toFixed(2))
    }));

  const previousRows = scoreByCompanyForDate(db, previousWeekDateIso(briefDate));
  const previousByCompany = new Map(previousRows.map((row) => [row.company_id, Number(row.score_value || 0)]));
  const emergingWatchlist = companyRows
    .map((row) => {
      const currentScore = Number(row.score_value || 0);
      const previousScore = Number(previousByCompany.get(row.company_id) || currentScore);
      const delta = currentScore - previousScore;
      return {
        companyId: row.company_id,
        uen: row.uen,
        companyName: row.registered_name,
        industryId: row.industry_id || null,
        industryCode: row.industry_code || null,
        industryName: row.industry_name || null,
        scoreDate: row.score_date,
        finalScore: Number(currentScore.toFixed(2)),
        weeklyDelta: Number(delta.toFixed(2))
      };
    })
    .filter((row) => row.weeklyDelta >= emergingDelta && row.finalScore < emergingCeiling)
    .sort((a, b) => b.weeklyDelta - a.weeklyDelta || b.finalScore - a.finalScore);

  const stressedCompanyCounts = new Map();
  for (const row of companyRows) {
    if (Number(row.score_value || 0) >= highRiskThreshold && row.industry_id) {
      stressedCompanyCounts.set(row.industry_id, Number(stressedCompanyCounts.get(row.industry_id) || 0) + 1);
    }
  }
  const industryStressClusters = stressedIndustries
    .map((industry) => ({
      industryId: industry.industryId,
      code: industry.code,
      name: industry.name,
      stressedCompanyCount: Number(stressedCompanyCounts.get(industry.industryId) || 0),
      industryRiskScore: industry.industryRiskScore
    }))
    .filter((cluster) => cluster.stressedCompanyCount >= 1)
    .sort((a, b) => b.stressedCompanyCount - a.stressedCompanyCount || b.industryRiskScore - a.industryRiskScore);

  const payload = {
    briefDate,
    generatedAt: new Date().toISOString(),
    config: {
      highRiskThreshold,
      industryStressGate,
      emergingDeltaThreshold: emergingDelta,
      emergingScoreCeiling: emergingCeiling
    },
    sections: {
      highRiskCompanies,
      stressedIndustries,
      majorEvents,
      emergingWatchlist
    },
    industryStressClusters,
    summary: {
      highRiskCount: highRiskCompanies.length,
      stressedIndustryCount: stressedIndustries.length,
      majorEventCount: majorEvents.length,
      emergingWatchlistCount: emergingWatchlist.length,
      clusterCount: industryStressClusters.length
    }
  };

  const existing = db.prepare("SELECT id FROM morning_brief WHERE brief_date = ?").get(briefDate);
  const briefId = existing?.id || randomUUID();
  db.prepare(
    `INSERT INTO morning_brief (id, brief_date, generated_at, payload)
     VALUES (?, ?, current_timestamp, ?)
     ON CONFLICT(brief_date) DO UPDATE SET
       generated_at = current_timestamp,
       payload = excluded.payload`
  ).run(briefId, briefDate, JSON.stringify(payload));

  return {
    id: briefId,
    briefDate,
    payload
  };
}

export function getMorningBriefByDate(db, briefDate) {
  const row = db
    .prepare(
      `SELECT id, brief_date, generated_at, payload
       FROM morning_brief
       WHERE brief_date = ?`
    )
    .get(briefDate);
  if (!row) {
    throw new Error("morning_brief not found");
  }

  return {
    id: row.id,
    briefDate: row.brief_date,
    generatedAt: row.generated_at,
    payload: JSON.parse(row.payload || "{}")
  };
}

export function getLatestMorningBrief(db) {
  const row = db
    .prepare(
      `SELECT id, brief_date, generated_at, payload
       FROM morning_brief
       ORDER BY brief_date DESC
       LIMIT 1`
    )
    .get();
  if (!row) {
    throw new Error("morning_brief not found");
  }

  return {
    id: row.id,
    briefDate: row.brief_date,
    generatedAt: row.generated_at,
    payload: JSON.parse(row.payload || "{}")
  };
}

export function listMorningBriefs(db, query) {
  const limit = clampLimit(query.limit, 20, 100);
  const offset = clampLimit(query.offset, 0, 100000);
  const rows = db
    .prepare(
      `SELECT id, brief_date, generated_at
       FROM morning_brief
       ORDER BY brief_date DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  const total = db.prepare("SELECT COUNT(*) AS count FROM morning_brief").get()?.count || 0;

  return {
    data: rows.map((row) => ({
      id: row.id,
      briefDate: row.brief_date,
      generatedAt: row.generated_at
    })),
    total: Number(total),
    limit,
    offset
  };
}

export function resolveScheduledBriefDateSgt() {
  return toSgtDateIso(new Date());
}

export function isAfterReadyTimeSgt(readyBy) {
  const parts = String(readyBy || "06:00").split(":");
  const readyHour = Number(parts[0] || 6);
  const readyMinute = Number(parts[1] || 0);

  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SGT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = Number(nowParts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(nowParts.find((part) => part.type === "minute")?.value || 0);

  if (hour > readyHour) return true;
  if (hour < readyHour) return false;
  return minute >= readyMinute;
}

export function hasBriefForDate(db, briefDate) {
  const row = db.prepare("SELECT id FROM morning_brief WHERE brief_date = ?").get(briefDate);
  return Boolean(row?.id);
}

export function getDailyBriefReadyByConfig(db) {
  const row = db.prepare("SELECT value FROM config_item WHERE key = 'daily_brief_ready_by_sgt'").get();
  return String(row?.value || "06:00");
}

export function previousIndustryWindowStart(briefDate) {
  return previousMonthStartIso(briefDate);
}
