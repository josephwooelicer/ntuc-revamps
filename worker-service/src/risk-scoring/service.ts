import { randomUUID } from "node:crypto";

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value)));
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function startOfWeekIso(value) {
  const base = value ? new Date(value) : new Date();
  const utc = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc.toISOString().slice(0, 10);
}

function endOfWeekIso(weekStartIso) {
  const start = new Date(`${weekStartIso}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

function startOfMonthIso(value) {
  const base = value ? new Date(value) : new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function endOfMonthIso(monthStartIso) {
  const start = new Date(`${monthStartIso}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function asNumberConfig(db, key, fallback) {
  const row = db.prepare("SELECT value FROM config_item WHERE key = ?").get(key);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function previousPeriodDate(periodType, scoreDate) {
  const current = new Date(`${scoreDate}T00:00:00.000Z`);
  if (periodType === "monthly") {
    current.setUTCMonth(current.getUTCMonth() - 1);
    return current.toISOString().slice(0, 10).replace(/-\d{2}$/, "-01");
  }

  current.setUTCDate(current.getUTCDate() - 7);
  return current.toISOString().slice(0, 10);
}

function formatContributionRows(rows, scoreDate) {
  return rows.map((row) => ({
    signalId: row.id,
    signalType: row.signal_type,
    category: row.category,
    signalTs: row.signal_ts,
    weightedValue: Number(Number(row.weighted_value || 0).toFixed(4)),
    impactScore: clampScore(50 + Number(row.weighted_value || 0) * 20),
    sourceId: row.source_id,
    evidence: {
      rawDocumentId: row.raw_document_id || null,
      pointerUrl: row.pointer_url || null,
      snippet: row.snippet || null
    },
    explanation: `Signal ${row.signal_type} in ${row.category} contributed ${Number(
      Number(row.weighted_value || 0).toFixed(2)
    )} weighted units as of ${scoreDate}.`
  }));
}

function upsertScoreSnapshotAndExplanation(db, input) {
  const snapshotId =
    db
      .prepare(
        `SELECT id
         FROM score_snapshot
         WHERE company_id IS ?
           AND industry_id IS ?
           AND score_type = ?
           AND period_type = ?
           AND score_date = ?`
      )
      .get(input.companyId || null, input.industryId || null, input.scoreType, input.periodType, input.scoreDate)
      ?.id || randomUUID();

  const detailsJson = JSON.stringify(input.details || {});
  const orderedContributionsJson = JSON.stringify(input.orderedContributions || []);
  const deltaSummaryJson = JSON.stringify(input.deltaSummary || {});

  db.prepare(
    `INSERT INTO score_snapshot (
      id, company_id, industry_id, score_type, period_type, score_date, score_value, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, industry_id, score_type, score_date) DO UPDATE SET
      score_value = excluded.score_value,
      details = excluded.details,
      created_at = current_timestamp`
  ).run(
    snapshotId,
    input.companyId || null,
    input.industryId || null,
    input.scoreType,
    input.periodType,
    input.scoreDate,
    Number(input.scoreValue.toFixed(2)),
    detailsJson
  );

  db.prepare("DELETE FROM score_explanation WHERE score_snapshot_id = ?").run(snapshotId);
  db.prepare(
    `INSERT INTO score_explanation (id, score_snapshot_id, ordered_contributions, delta_summary)
     VALUES (?, ?, ?, ?)`
  ).run(randomUUID(), snapshotId, orderedContributionsJson, deltaSummaryJson);

  return snapshotId;
}

function computeIndustryScore(db, industryId, monthStart, monthEnd) {
  const rows = db
    .prepare(
      `SELECT s.id, s.source_id, s.signal_type, s.category, s.signal_ts, s.weighted_value,
              ep.raw_document_id, ep.pointer_url, ep.snippet
       FROM signal s
       LEFT JOIN evidence_pointer ep ON ep.signal_id = s.id
       WHERE s.industry_id = ?
         AND s.company_id IS NULL
         AND date(s.signal_ts) >= date(?)
         AND date(s.signal_ts) <= date(?)
       ORDER BY s.weighted_value DESC, s.signal_ts DESC`
    )
    .all(industryId, monthStart, monthEnd);

  const weightedAvg =
    rows.length === 0
      ? 0
      : rows.reduce((sum, row) => sum + Number(row.weighted_value || 0), 0) / Math.max(rows.length, 1);
  const scoreValue = clampScore(50 + weightedAvg * 20);
  const orderedContributions = formatContributionRows(rows, monthStart);

  return {
    scoreValue,
    signalCount: rows.length,
    orderedContributions
  };
}

function computeCompanySignalsScore(db, companyId, weekStart, weekEnd) {
  const rows = db
    .prepare(
      `SELECT s.id, s.source_id, s.signal_type, s.category, s.signal_ts, s.weighted_value,
              ep.raw_document_id, ep.pointer_url, ep.snippet
       FROM signal s
       LEFT JOIN evidence_pointer ep ON ep.signal_id = s.id
       WHERE s.company_id = ?
         AND date(s.signal_ts) >= date(?)
         AND date(s.signal_ts) <= date(?)
       ORDER BY s.weighted_value DESC, s.signal_ts DESC`
    )
    .all(companyId, weekStart, weekEnd);

  const weightedAvg =
    rows.length === 0
      ? 0
      : rows.reduce((sum, row) => sum + Number(row.weighted_value || 0), 0) / Math.max(rows.length, 1);
  const scoreValue = clampScore(50 + weightedAvg * 20);
  const orderedContributions = formatContributionRows(rows, weekStart);

  return {
    scoreValue,
    signalCount: rows.length,
    orderedContributions
  };
}

function buildDeltaSummary(db, snapshotId, periodType, scoreDate, scoreValue, signalCount) {
  const previousDate = previousPeriodDate(periodType, scoreDate);
  const previousSnapshot = db
    .prepare(
      `SELECT score_value, details
       FROM score_snapshot
       WHERE id != ?
         AND company_id IS (SELECT company_id FROM score_snapshot WHERE id = ?)
         AND industry_id IS (SELECT industry_id FROM score_snapshot WHERE id = ?)
         AND score_type IS (SELECT score_type FROM score_snapshot WHERE id = ?)
         AND period_type = ?
         AND score_date = ?
       LIMIT 1`
    )
    .get(snapshotId, snapshotId, snapshotId, snapshotId, periodType, previousDate);

  const previousValue = Number(previousSnapshot?.score_value ?? scoreValue);
  let previousSignalCount = signalCount;
  try {
    previousSignalCount = Number(JSON.parse(previousSnapshot?.details || "{}")?.signalCount ?? signalCount);
  } catch {
    previousSignalCount = signalCount;
  }

  return {
    previousScoreDate: previousDate,
    previousScore: Number(previousValue.toFixed(2)),
    currentScore: Number(scoreValue.toFixed(2)),
    scoreDelta: Number((scoreValue - previousValue).toFixed(2)),
    previousSignalCount,
    currentSignalCount: signalCount,
    signalCountDelta: signalCount - previousSignalCount
  };
}

function listTargetIndustries(db, industryIds) {
  if (industryIds?.length) {
    const placeholders = industryIds.map(() => "?").join(",");
    return db.prepare(`SELECT id FROM industry WHERE id IN (${placeholders})`).all(...industryIds);
  }
  return db.prepare("SELECT id FROM industry").all();
}

function listTargetCompanies(db, companyIds) {
  if (companyIds?.length) {
    const placeholders = companyIds.map(() => "?").join(",");
    return db
      .prepare(`SELECT id, industry_id FROM company WHERE is_active = 1 AND id IN (${placeholders})`)
      .all(...companyIds);
  }
  return db.prepare("SELECT id, industry_id FROM company WHERE is_active = 1").all();
}

function latestIndustryScoreForDate(db, industryId, scoreDate) {
  return db
    .prepare(
      `SELECT score_value
       FROM score_snapshot
       WHERE industry_id = ?
         AND company_id IS NULL
         AND score_type = 'industry'
         AND score_date <= ?
       ORDER BY score_date DESC
       LIMIT 1`
    )
    .get(industryId, scoreDate);
}

export function runIndustryMonthlyScoring(db, input) {
  const monthStart = startOfMonthIso(toIsoDate(input.month) || undefined);
  const monthEnd = endOfMonthIso(monthStart);
  const industries = listTargetIndustries(db, input.industryIds);

  const results = [];
  db.exec("BEGIN;");
  try {
    for (const industry of industries) {
      const computed = computeIndustryScore(db, industry.id, monthStart, monthEnd);
      const details = {
        signalCount: computed.signalCount,
        window: { start: monthStart, end: monthEnd },
        breakdown: { industryScore: Number(computed.scoreValue.toFixed(2)) }
      };

      const snapshotId = upsertScoreSnapshotAndExplanation(db, {
        companyId: null,
        industryId: industry.id,
        scoreType: "industry",
        periodType: "monthly",
        scoreDate: monthStart,
        scoreValue: computed.scoreValue,
        details,
        orderedContributions: computed.orderedContributions,
        deltaSummary: {}
      });

      const deltaSummary = buildDeltaSummary(
        db,
        snapshotId,
        "monthly",
        monthStart,
        computed.scoreValue,
        computed.signalCount
      );
      db.prepare("UPDATE score_explanation SET delta_summary = ? WHERE score_snapshot_id = ?").run(
        JSON.stringify(deltaSummary),
        snapshotId
      );

      results.push({
        snapshotId,
        industryId: industry.id,
        scoreDate: monthStart,
        scoreValue: Number(computed.scoreValue.toFixed(2))
      });
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    month: monthStart,
    periodType: "monthly",
    scoredIndustries: results.length,
    data: results
  };
}

export function runCompanyWeeklyScoring(db, input) {
  const weekStart = startOfWeekIso(toIsoDate(input.weekStart) || undefined);
  const weekEnd = endOfWeekIso(weekStart);
  const companies = listTargetCompanies(db, input.companyIds);
  const industryGateThreshold = asNumberConfig(db, "industry_stress_gate_threshold", 60);
  const industryAdjustmentWeight = asNumberConfig(db, "industry_adjustment_weight", 0.3);

  const results = [];
  db.exec("BEGIN;");
  try {
    for (const company of companies) {
      const companyComputed = computeCompanySignalsScore(db, company.id, weekStart, weekEnd);
      const industrySnapshot = company.industry_id
        ? latestIndustryScoreForDate(db, company.industry_id, weekStart)
        : null;
      const industryScore = Number(industrySnapshot?.score_value || 0);
      const gateOpen = industryScore >= industryGateThreshold;
      const industryAdjustment = gateOpen ? industryScore * industryAdjustmentWeight : 0;
      const finalScore = clampScore(companyComputed.scoreValue + industryAdjustment);

      const companyDetails = {
        signalCount: companyComputed.signalCount,
        window: { start: weekStart, end: weekEnd },
        breakdown: { companySignalsScore: Number(companyComputed.scoreValue.toFixed(2)) }
      };

      const companySnapshotId = upsertScoreSnapshotAndExplanation(db, {
        companyId: company.id,
        industryId: company.industry_id || null,
        scoreType: "company",
        periodType: "weekly",
        scoreDate: weekStart,
        scoreValue: companyComputed.scoreValue,
        details: companyDetails,
        orderedContributions: companyComputed.orderedContributions,
        deltaSummary: {}
      });

      const companyDelta = buildDeltaSummary(
        db,
        companySnapshotId,
        "weekly",
        weekStart,
        companyComputed.scoreValue,
        companyComputed.signalCount
      );
      db.prepare("UPDATE score_explanation SET delta_summary = ? WHERE score_snapshot_id = ?").run(
        JSON.stringify(companyDelta),
        companySnapshotId
      );

      const finalDetails = {
        signalCount: companyComputed.signalCount,
        window: { start: weekStart, end: weekEnd },
        breakdown: {
          companySignalsScore: Number(companyComputed.scoreValue.toFixed(2)),
          industryScore: Number(industryScore.toFixed(2)),
          gateOpen,
          industryGateThreshold: Number(industryGateThreshold.toFixed(2)),
          industryAdjustmentWeight: Number(industryAdjustmentWeight.toFixed(4)),
          industryAdjustment: Number(industryAdjustment.toFixed(2)),
          finalScore: Number(finalScore.toFixed(2))
        }
      };

      const finalContributions = [
        ...companyComputed.orderedContributions,
        {
          signalId: null,
          signalType: "industry_context",
          category: "gated_adjustment",
          signalTs: weekStart,
          weightedValue: Number(industryAdjustment.toFixed(4)),
          impactScore: Number(industryScore.toFixed(2)),
          sourceId: null,
          evidence: null,
          explanation: gateOpen
            ? `Industry gate open at ${industryScore.toFixed(2)} >= ${industryGateThreshold.toFixed(
                2
              )}; adjustment applied.`
            : `Industry gate closed at ${industryScore.toFixed(2)} < ${industryGateThreshold.toFixed(
                2
              )}; no adjustment applied.`
        }
      ];

      const finalSnapshotId = upsertScoreSnapshotAndExplanation(db, {
        companyId: company.id,
        industryId: company.industry_id || null,
        scoreType: "final",
        periodType: "weekly",
        scoreDate: weekStart,
        scoreValue: finalScore,
        details: finalDetails,
        orderedContributions: finalContributions,
        deltaSummary: {}
      });

      const finalDelta = buildDeltaSummary(db, finalSnapshotId, "weekly", weekStart, finalScore, companyComputed.signalCount);
      db.prepare("UPDATE score_explanation SET delta_summary = ? WHERE score_snapshot_id = ?").run(
        JSON.stringify(finalDelta),
        finalSnapshotId
      );

      results.push({
        companyId: company.id,
        industryId: company.industry_id || null,
        weekStart,
        companySnapshotId,
        finalSnapshotId,
        companySignalsScore: Number(companyComputed.scoreValue.toFixed(2)),
        industryScore: Number(industryScore.toFixed(2)),
        finalScore: Number(finalScore.toFixed(2)),
        gateOpen
      });
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    weekStart,
    periodType: "weekly",
    scoredCompanies: results.length,
    data: results
  };
}

function enumerateWeeklyStarts(startDate, endDate) {
  const starts = [];
  let cursor = new Date(`${startOfWeekIso(startDate)}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    starts.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return starts;
}

function enumerateMonthlyStarts(startDate, endDate) {
  const starts = [];
  let cursor = new Date(`${startOfMonthIso(startDate)}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    starts.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return starts;
}

export function recomputeScores(db, input) {
  if (!input.startDate || !input.endDate) {
    throw new Error("Missing required fields: startDate, endDate");
  }

  const startDate = toIsoDate(input.startDate);
  const endDate = toIsoDate(input.endDate);
  if (!startDate || !endDate) {
    throw new Error("Invalid startDate or endDate");
  }
  if (startDate > endDate) {
    throw new Error("startDate must be <= endDate");
  }

  const monthlyRuns = [];
  for (const month of enumerateMonthlyStarts(startDate, endDate)) {
    monthlyRuns.push(runIndustryMonthlyScoring(db, { month, industryIds: input.industryIds }));
  }

  const weeklyRuns = [];
  for (const weekStart of enumerateWeeklyStarts(startDate, endDate)) {
    weeklyRuns.push(runCompanyWeeklyScoring(db, { weekStart, companyIds: input.companyIds }));
  }

  return {
    startDate,
    endDate,
    monthlyRuns: monthlyRuns.length,
    weeklyRuns: weeklyRuns.length,
    industrySnapshots: monthlyRuns.reduce((sum, run) => sum + run.scoredIndustries, 0),
    companySnapshots: weeklyRuns.reduce((sum, run) => sum + run.scoredCompanies, 0)
  };
}

export function listCompanyScores(db, companyId, query) {
  const clauses = ["company_id = ?"];
  const params = [companyId];

  if (query.start) {
    clauses.push("score_date >= ?");
    params.push(toIsoDate(query.start));
  }
  if (query.end) {
    clauses.push("score_date <= ?");
    params.push(toIsoDate(query.end));
  }
  if (query.type) {
    clauses.push("score_type = ?");
    params.push(query.type);
  }

  const rows = db
    .prepare(
      `SELECT id, company_id, industry_id, score_type, period_type, score_date, score_value, details, created_at
       FROM score_snapshot
       WHERE ${clauses.join(" AND ")}
       ORDER BY score_date DESC, created_at DESC`
    )
    .all(...params)
    .map((row) => ({
      ...row,
      details: JSON.parse(row.details || "{}")
    }));

  return { data: rows, count: rows.length };
}

export function listIndustryScores(db, industryId, query) {
  const clauses = ["industry_id = ?", "company_id IS NULL", "score_type = 'industry'"];
  const params = [industryId];

  if (query.start) {
    clauses.push("score_date >= ?");
    params.push(toIsoDate(query.start));
  }
  if (query.end) {
    clauses.push("score_date <= ?");
    params.push(toIsoDate(query.end));
  }

  const rows = db
    .prepare(
      `SELECT id, company_id, industry_id, score_type, period_type, score_date, score_value, details, created_at
       FROM score_snapshot
       WHERE ${clauses.join(" AND ")}
       ORDER BY score_date DESC, created_at DESC`
    )
    .all(...params)
    .map((row) => ({
      ...row,
      details: JSON.parse(row.details || "{}")
    }));

  return { data: rows, count: rows.length };
}

export function getScoreExplanation(db, scoreSnapshotId) {
  const snapshot = db
    .prepare(
      `SELECT id, company_id, industry_id, score_type, period_type, score_date, score_value, details, created_at
       FROM score_snapshot
       WHERE id = ?`
    )
    .get(scoreSnapshotId);

  if (!snapshot) {
    throw new Error("score_snapshot not found");
  }

  const explanation = db
    .prepare(
      `SELECT id, score_snapshot_id, ordered_contributions, delta_summary
       FROM score_explanation
       WHERE score_snapshot_id = ?`
    )
    .get(scoreSnapshotId);

  return {
    snapshot: {
      ...snapshot,
      details: JSON.parse(snapshot.details || "{}")
    },
    explanation: explanation
      ? {
          id: explanation.id,
          scoreSnapshotId: explanation.score_snapshot_id,
          orderedContributions: JSON.parse(explanation.ordered_contributions || "[]"),
          deltaSummary: JSON.parse(explanation.delta_summary || "{}")
        }
      : null
  };
}
