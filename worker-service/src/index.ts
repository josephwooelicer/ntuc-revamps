import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./db/migrate.js";
import { openDb, getDbPath } from "./db/client.js";
import { insertAuditLog } from "./db/audit.js";
import { resolveRepoPath } from "./lib/paths.js";
import { createSource, listSources } from "./ingestion/sourceRegistry.js";
import { fetchIngestionRun, runBackfillNews, runIngestion } from "./ingestion/service.js";
import {
  generateMorningBrief,
  getDailyBriefReadyByConfig,
  getLatestMorningBrief,
  getMorningBriefByDate,
  hasBriefForDate,
  isAfterReadyTimeSgt,
  listMorningBriefs,
  resolveScheduledBriefDateSgt
} from "./briefing/service.js";
import {
  addCompanyAlias,
  approveEntityResolution,
  listCompanyAliases,
  listReviewQueue,
  rejectEntityResolution,
  resolveEntities
} from "./entity-resolution/service.js";
import { listCompanySignals, listIndustrySignals, processSignals } from "./signal-processing/service.js";
import {
  getScoreExplanation,
  listCompanyScores,
  listIndustryScores,
  recomputeScores,
  runCompanyWeeklyScoring,
  runIndustryMonthlyScoring
} from "./risk-scoring/service.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT_WORKER || 4000);
const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";
const briefSchedulerIntervalMs = Number(process.env.BRIEF_SCHEDULER_INTERVAL_MS || 60_000);
const briefSchedulerEnabled = String(process.env.BRIEF_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
const schedulerState = {
  enabled: briefSchedulerEnabled,
  intervalMs: briefSchedulerIntervalMs,
  lastRunAt: null,
  lastBriefDate: null,
  lastStatus: "idle",
  lastError: null
};

function readJsonBody(req) {
  return new Promise<any>((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function routePath(req) {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams
  };
}

function hasCoreTables() {
  const db = openDb();
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='audit_log'")
    .get();
  db.close();
  return Number(row.count) === 1;
}

function checkHealth() {
  const resolvedDbPath = getDbPath();
  const resolvedRawPath = resolveRepoPath(rawPath);

  return {
    status: "ok",
    service: "worker-service",
    db_file_exists: fs.existsSync(resolvedDbPath),
    db_schema_ready: hasCoreTables(),
    storage: fs.existsSync(resolvedRawPath),
    scheduler: schedulerState,
    timestamp: new Date().toISOString()
  };
}

function withDb(handler) {
  const db = openDb();
  try {
    return handler(db);
  } finally {
    db.close();
  }
}

function getUserById(db, userId) {
  if (!userId) return null;
  return db.prepare("SELECT id, email, role FROM app_user WHERE id = ?").get(userId) || null;
}

function getUserFromRequest(req, route) {
  const userId = req.headers["x-user-id"] || route.searchParams.get("userId") || null;
  return withDb((db) => getUserById(db, userId));
}

function hasPermission(db, role, permission) {
  if (!role) return false;
  const row = db
    .prepare("SELECT 1 FROM role_permission WHERE role = ? AND permission = ? LIMIT 1")
    .get(role, permission);
  return Boolean(row);
}

function requirePermission(user, permission) {
  const allowed = withDb((db) => hasPermission(db, user?.role || null, permission));
  if (!allowed) {
    throw new Error(`Forbidden: missing permission ${permission}`);
  }
}

function listIndustries(db) {
  return db.prepare("SELECT id, code, name FROM industry ORDER BY code").all();
}

function listCompanies(db, industryId) {
  const where = industryId ? "WHERE c.is_active = 1 AND c.industry_id = ?" : "WHERE c.is_active = 1";
  const params = industryId ? [industryId] : [];
  return db
    .prepare(
      `SELECT c.id, c.uen, c.registered_name, c.industry_id, i.name AS industry_name
       FROM company c
       LEFT JOIN industry i ON i.id = c.industry_id
       ${where}
       ORDER BY c.registered_name`
    )
    .all(...params);
}

function listConfigItems(db, scope) {
  if (scope) {
    return db
      .prepare("SELECT key, value, scope, updated_by, updated_at FROM config_item WHERE scope = ? ORDER BY key")
      .all(scope);
  }
  return db.prepare("SELECT key, value, scope, updated_by, updated_at FROM config_item ORDER BY scope, key").all();
}

function parseConfigValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;
    if (String(raw).toLowerCase() === "true") return true;
    if (String(raw).toLowerCase() === "false") return false;
    return raw;
  }
}

function resolveOverrideScope(snapshot) {
  return snapshot.score_type === "industry" ? "industry" : "company";
}

function applyScoreOverride(body) {
  const { scoreSnapshotId, overriddenScore, reason, actorUserId } = body;
  if (!scoreSnapshotId || overriddenScore == null || !reason) {
    throw new Error("Missing required fields: scoreSnapshotId, overriddenScore, reason");
  }

  return withDb((db) => {
    const snapshot = db.prepare("SELECT id, score_value, score_type FROM score_snapshot WHERE id = ?").get(scoreSnapshotId);

    if (!snapshot) {
      throw new Error("score_snapshot not found");
    }

    const scope = resolveOverrideScope(snapshot);
    const actor = getUserById(db, actorUserId);
    const requiredPermission =
      scope === "industry" ? "industry.score.override" : "company.score.override";
    if (!hasPermission(db, actor?.role || null, requiredPermission)) {
      throw new Error(`Forbidden: missing permission ${requiredPermission}`);
    }

    const newOverride = {
      id: randomUUID(),
      score_snapshot_id: scoreSnapshotId,
      original_score: Number(snapshot.score_value),
      overridden_score: Number(overriddenScore),
      reason,
      scope,
      created_by: actorUserId || null
    };

    db.exec("BEGIN;");
    try {
      db
        .prepare(
          `INSERT INTO score_override (
            id, score_snapshot_id, original_score, overridden_score, reason, scope, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newOverride.id,
          newOverride.score_snapshot_id,
          newOverride.original_score,
          newOverride.overridden_score,
          newOverride.reason,
          newOverride.scope,
          newOverride.created_by
        );

      insertAuditLog(db, {
        actorUserId: actorUserId || null,
        action: "score_override.created",
        entityType: "score_override",
        entityId: newOverride.id,
        beforeState: { score_snapshot_id: scoreSnapshotId, score_value: snapshot.score_value },
        afterState: newOverride
      });

      db.exec("COMMIT;");
      return newOverride;
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  });
}

function upsertConfig(body) {
  const { key, value, scope, actorUserId } = body;
  if (!key || value == null || !scope) {
    throw new Error("Missing required fields: key, value, scope");
  }

  return withDb((db) => {
    const actor = getUserById(db, actorUserId);
    const requiredPermission =
      scope === "industry"
        ? "industry.settings.update"
        : scope === "company"
        ? "company.settings.update"
        : "ops.manage";
    if (!hasPermission(db, actor?.role || null, requiredPermission)) {
      throw new Error(`Forbidden: missing permission ${requiredPermission}`);
    }

    const before = db.prepare("SELECT * FROM config_item WHERE key = ?").get(key) || null;

    db.exec("BEGIN;");
    try {
      db
        .prepare(
          `INSERT INTO config_item (key, value, scope, updated_by, updated_at)
           VALUES (?, ?, ?, ?, current_timestamp)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             scope = excluded.scope,
             updated_by = excluded.updated_by,
             updated_at = current_timestamp`
        )
        .run(key, String(value), scope, actorUserId || null);

      const after = db.prepare("SELECT * FROM config_item WHERE key = ?").get(key);

      insertAuditLog(db, {
        actorUserId: actorUserId || null,
        action: "config_item.upserted",
        entityType: "config_item",
        entityId: key,
        beforeState: before,
        afterState: after
      });

      db.exec("COMMIT;");
      return after;
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  });
}

function decideModelRecommendation(recommendationId, body) {
  const { status, actorUserId } = body;
  if (!status || !["approved", "rejected"].includes(status)) {
    throw new Error("status must be one of: approved, rejected");
  }

  return withDb((db) => {
    const before = db.prepare("SELECT * FROM model_recommendation WHERE id = ?").get(recommendationId);
    if (!before) {
      throw new Error("model_recommendation not found");
    }

    db.exec("BEGIN;");
    try {
      db
        .prepare(
          `UPDATE model_recommendation
           SET status = ?, decided_by = ?, decided_at = current_timestamp
           WHERE id = ?`
        )
        .run(status, actorUserId || null, recommendationId);

      const after = db.prepare("SELECT * FROM model_recommendation WHERE id = ?").get(recommendationId);

      insertAuditLog(db, {
        actorUserId,
        action: "model_recommendation.decided",
        entityType: "model_recommendation",
        entityId: recommendationId,
        beforeState: before,
        afterState: after
      });

      db.exec("COMMIT;");
      return after;
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  });
}

function resolveCompanyIdForOnDemand(db, payload) {
  if (payload.companyId) {
    const byId = db.prepare("SELECT id FROM company WHERE id = ?").get(payload.companyId);
    if (!byId) throw new Error("company not found");
    return byId.id;
  }

  const query = String(payload.query || "").trim();
  if (!query) {
    throw new Error("Missing required field: companyId or query");
  }

  const like = `%${query}%`;
  const row = db
    .prepare(
      `SELECT c.id
       FROM company c
       LEFT JOIN company_alias ca ON ca.company_id = c.id
       WHERE c.uen = ?
          OR c.registered_name LIKE ?
          OR ca.alias LIKE ?
       ORDER BY c.created_at ASC
       LIMIT 1`
    )
    .get(query, like, like);

  if (!row) {
    throw new Error("No company matched query");
  }
  return row.id;
}

function upsertOnDemandJob(db, job) {
  db
    .prepare(
      `INSERT INTO on_demand_analysis_job (
         id, company_id, query, status, created_by, created_at, started_at
       ) VALUES (?, ?, ?, 'running', ?, current_timestamp, current_timestamp)`
    )
    .run(job.id, job.companyId, job.query || null, job.createdBy || null);
}

function completeOnDemandJob(
  db,
  { jobId, status, reportPath, error }: { jobId: string; status: string; reportPath?: string | null; error?: string | null }
) {
  db
    .prepare(
      `UPDATE on_demand_analysis_job
       SET status = ?, report_path = ?, error = ?, completed_at = current_timestamp
       WHERE id = ?`
    )
    .run(status, reportPath || null, error || null, jobId);
}

function getOnDemandJob(db, jobId) {
  const row = db.prepare("SELECT * FROM on_demand_analysis_job WHERE id = ?").get(jobId);
  if (!row) throw new Error("on_demand_analysis_job not found");
  return row;
}

function executeOnDemandAnalysis(db, job) {
  const run = runIngestion(db, {
    sourceId: "src-news",
    runType: "on_demand"
  });
  resolveEntities(db, { ingestionRunId: run.run.id, actorUserId: job.createdBy || null });
  processSignals(db, { ingestionRunId: run.run.id });

  const company = db
    .prepare("SELECT id, industry_id FROM company WHERE id = ?")
    .get(job.companyId);
  if (!company) throw new Error("company not found");

  runIndustryMonthlyScoring(db, {
    month: new Date().toISOString(),
    industryIds: company.industry_id ? [company.industry_id] : undefined
  });
  const weekly = runCompanyWeeklyScoring(db, {
    weekStart: new Date().toISOString(),
    companyIds: [job.companyId]
  });

  const latest = weekly.data[0];
  const explanation = getScoreExplanation(db, latest.finalSnapshotId);

  const report = {
    jobId: job.id,
    companyId: job.companyId,
    ingestionRunId: run.run.id,
    generatedAt: new Date().toISOString(),
    summary: latest,
    explanation
  };

  const reportPath = path.join("data-lake", "reports", "on-demand", `${job.id}.json`);
  const absolutePath = resolveRepoPath(reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(report, null, 2));

  return { reportPath, report };
}

function runDailyBriefSchedulerTick() {
  if (!schedulerState.enabled) return;

  try {
    const briefDate = resolveScheduledBriefDateSgt();
    withDb((db) => {
      const readyBy = getDailyBriefReadyByConfig(db);
      if (!isAfterReadyTimeSgt(readyBy)) {
        schedulerState.lastStatus = "waiting_for_ready_time";
        return;
      }
      if (hasBriefForDate(db, briefDate)) {
        schedulerState.lastStatus = "already_generated";
        schedulerState.lastBriefDate = briefDate;
        return;
      }

      db.exec("BEGIN;");
      try {
        const brief = generateMorningBrief(db, { briefDate });
        insertAuditLog(db, {
          actorUserId: null,
          action: "morning_brief.generated",
          entityType: "morning_brief",
          entityId: brief.id,
          beforeState: null,
          afterState: { briefDate: brief.briefDate, mode: "scheduled" }
        });
        db.exec("COMMIT;");
        schedulerState.lastStatus = "generated";
        schedulerState.lastBriefDate = briefDate;
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    });
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastError = null;
  } catch (error) {
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastStatus = "error";
    schedulerState.lastError = error.message;
  }
}

runMigrations();

const server = http.createServer(async (req, res) => {
  try {
    const route = routePath(req);
    const { pathname } = route;

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, checkHealth());
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/me") {
      const user = getUserFromRequest(req, route);
      if (!user) {
        sendJson(res, 401, { error: "Unauthorized: provide x-user-id header or userId query" });
        return;
      }
      sendJson(res, 200, user);
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/industries") {
      const rows = withDb((db) => listIndustries(db));
      sendJson(res, 200, { data: rows, count: rows.length });
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/companies") {
      const rows = withDb((db) => listCompanies(db, route.searchParams.get("industryId")));
      sendJson(res, 200, { data: rows, count: rows.length });
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/sources") {
      const rows = withDb((db) => listSources(db));
      sendJson(res, 200, { data: rows });
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/sources") {
      const body = await readJsonBody(req);
      const created = withDb((db) => {
        db.exec("BEGIN;");
        try {
          const source = createSource(db, body);
          insertAuditLog(db, {
            actorUserId: body.actorUserId,
            action: "data_source.created",
            entityType: "data_source",
            entityId: source.id,
            beforeState: null,
            afterState: source
          });
          db.exec("COMMIT;");
          return source;
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }
      });
      sendJson(res, 201, created);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/ingestion/runs") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        runIngestion(db, {
          sourceId: body.sourceId,
          runType: body.runType,
          rangeStart: body.rangeStart,
          rangeEnd: body.rangeEnd,
          cursor: body.cursor || null
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/ingestion/backfill/news") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        runBackfillNews(db, {
          sourceId: body.sourceId,
          rangeStart: body.rangeStart,
          rangeEnd: body.rangeEnd
        })
      );
      sendJson(res, 201, result);
      return;
    }

    const ingestionRunMatch = pathname.match(/^\/api\/v1\/ingestion\/runs\/([^/]+)$/);
    if (req.method === "GET" && ingestionRunMatch) {
      const row = withDb((db) => fetchIngestionRun(db, ingestionRunMatch[1]));
      sendJson(res, 200, row);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/overrides") {
      const body = await readJsonBody(req);
      const result = applyScoreOverride(body);
      sendJson(res, 201, result);
      return;
    }

    const scoreOverrideMatch = pathname.match(/^\/api\/v1\/scores\/([^/]+)\/override$/);
    if (req.method === "POST" && scoreOverrideMatch) {
      const body = await readJsonBody(req);
      const result = applyScoreOverride({
        scoreSnapshotId: scoreOverrideMatch[1],
        overriddenScore: body.overriddenScore,
        reason: body.reason,
        actorUserId: body.actorUserId || req.headers["x-user-id"] || null
      });
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/config") {
      const rows = withDb((db) => listConfigItems(db, route.searchParams.get("scope")));
      sendJson(res, 200, {
        data: rows.map((row) => ({
          ...row,
          parsedValue: parseConfigValue(row.value)
        })),
        count: rows.length
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/config") {
      const body = await readJsonBody(req);
      const result = upsertConfig(body);
      sendJson(res, 200, result);
      return;
    }

    const configUpdateMatch = pathname.match(/^\/api\/v1\/config\/([^/]+)$/);
    if (req.method === "PUT" && configUpdateMatch) {
      const body = await readJsonBody(req);
      const result = upsertConfig({
        key: configUpdateMatch[1],
        value: body.value,
        scope: body.scope,
        actorUserId: body.actorUserId || req.headers["x-user-id"] || null
      });
      sendJson(res, 200, result);
      return;
    }

    const recommendationMatch = pathname.match(/^\/api\/v1\/model-recommendations\/([^/]+)\/decision$/);
    if (req.method === "POST" && recommendationMatch) {
      const body = await readJsonBody(req);
      const result = decideModelRecommendation(recommendationMatch[1], body);
      sendJson(res, 200, result);
      return;
    }

    const entityReviewMatch = pathname.match(/^\/api\/v1\/entity-resolution\/([^/]+)\/review$/);
    if (req.method === "POST" && entityReviewMatch) {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        body.status === "approved"
          ? approveEntityResolution(db, entityReviewMatch[1], {
              companyId: body.companyId || body.matchedCompanyId,
              alias: body.alias,
              actorUserId: body.actorUserId
            })
          : rejectEntityResolution(db, entityReviewMatch[1], {
              reason: body.reason || "manual rejection",
              actorUserId: body.actorUserId
            })
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/entity-resolution/resolve") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        resolveEntities(db, {
          rawDocumentId: body.rawDocumentId,
          ingestionRunId: body.ingestionRunId,
          actorUserId: body.actorUserId
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/signals/process") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        processSignals(db, {
          ingestionRunId: body.ingestionRunId
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/scoring/run/company-weekly") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        runCompanyWeeklyScoring(db, {
          weekStart: body.weekStart,
          companyIds: body.companyIds
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/scoring/run/industry-monthly") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        runIndustryMonthlyScoring(db, {
          month: body.month,
          industryIds: body.industryIds
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/scoring/recompute") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        recomputeScores(db, {
          startDate: body.startDate,
          endDate: body.endDate,
          companyIds: body.companyIds,
          industryIds: body.industryIds
        })
      );
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/analysis/on-demand") {
      const body = await readJsonBody(req);
      const actorUserId = body.actorUserId || req.headers["x-user-id"] || null;

      const created = withDb((db) => {
        const companyId = resolveCompanyIdForOnDemand(db, body);
        const job = {
          id: randomUUID(),
          companyId,
          query: body.query || null,
          createdBy: actorUserId
        };
        upsertOnDemandJob(db, job);
        return job;
      });

      try {
        const completed = withDb((db) => executeOnDemandAnalysis(db, created));
        withDb((db) => {
          completeOnDemandJob(db, {
            jobId: created.id,
            status: "success",
            reportPath: completed.reportPath
          });
          insertAuditLog(db, {
            actorUserId: actorUserId || null,
            action: "on_demand_analysis.completed",
            entityType: "on_demand_analysis_job",
            entityId: created.id,
            beforeState: { status: "running" },
            afterState: { status: "success", reportPath: completed.reportPath }
          });
        });
      } catch (error) {
        withDb((db) => {
          completeOnDemandJob(db, {
            jobId: created.id,
            status: "failed",
            error: error.message
          });
          insertAuditLog(db, {
            actorUserId: actorUserId || null,
            action: "on_demand_analysis.completed",
            entityType: "on_demand_analysis_job",
            entityId: created.id,
            beforeState: { status: "running" },
            afterState: { status: "failed", error: error.message }
          });
        });
      }

      const result = withDb((db) => getOnDemandJob(db, created.id));
      sendJson(res, 201, result);
      return;
    }

    const onDemandJobMatch = pathname.match(/^\/api\/v1\/analysis\/on-demand\/([^/]+)$/);
    if (req.method === "GET" && onDemandJobMatch) {
      const job = withDb((db) => getOnDemandJob(db, onDemandJobMatch[1]));
      let report = null;
      if (job.report_path) {
        const reportAbs = resolveRepoPath(job.report_path);
        if (fs.existsSync(reportAbs)) {
          report = JSON.parse(fs.readFileSync(reportAbs, "utf8"));
        }
      }
      sendJson(res, 200, { ...job, report });
      return;
    }

    if (req.method === "POST" && pathname === "/api/v1/briefs/generate") {
      const body = await readJsonBody(req);
      const result = withDb((db) => {
        db.exec("BEGIN;");
        try {
          const brief = generateMorningBrief(db, { briefDate: body.briefDate });
          insertAuditLog(db, {
            actorUserId: body.actorUserId || null,
            action: "morning_brief.generated",
            entityType: "morning_brief",
            entityId: brief.id,
            beforeState: null,
            afterState: { briefDate: brief.briefDate, mode: "manual" }
          });
          db.exec("COMMIT;");
          return brief;
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }
      });
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/briefs") {
      const result = withDb((db) =>
        listMorningBriefs(db, {
          limit: route.searchParams.get("limit"),
          offset: route.searchParams.get("offset")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/briefs/latest") {
      const result = withDb((db) => getLatestMorningBrief(db));
      sendJson(res, 200, result);
      return;
    }

    const briefDateMatch = pathname.match(/^\/api\/v1\/briefs\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "GET" && briefDateMatch) {
      const result = withDb((db) => getMorningBriefByDate(db, briefDateMatch[1]));
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && pathname === "/api/v1/entity-resolution/review-queue") {
      const result = withDb((db) =>
        listReviewQueue(db, {
          limit: route.searchParams.get("limit"),
          offset: route.searchParams.get("offset")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const entityApproveMatch = pathname.match(/^\/api\/v1\/entity-resolution\/([^/]+)\/approve$/);
    if (req.method === "POST" && entityApproveMatch) {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        approveEntityResolution(db, entityApproveMatch[1], {
          companyId: body.companyId,
          alias: body.alias,
          actorUserId: body.actorUserId
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const entityRejectMatch = pathname.match(/^\/api\/v1\/entity-resolution\/([^/]+)\/reject$/);
    if (req.method === "POST" && entityRejectMatch) {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        rejectEntityResolution(db, entityRejectMatch[1], {
          reason: body.reason,
          actorUserId: body.actorUserId
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const companyAliasesMatch = pathname.match(/^\/api\/v1\/companies\/([^/]+)\/aliases$/);
    if (companyAliasesMatch && req.method === "GET") {
      const result = withDb((db) => listCompanyAliases(db, companyAliasesMatch[1]));
      sendJson(res, 200, result);
      return;
    }

    if (companyAliasesMatch && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = withDb((db) =>
        addCompanyAlias(db, companyAliasesMatch[1], {
          alias: body.alias,
          source: body.source,
          actorUserId: body.actorUserId
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const companySignalsMatch = pathname.match(/^\/api\/v1\/companies\/([^/]+)\/signals$/);
    if (companySignalsMatch && req.method === "GET") {
      const result = withDb((db) =>
        listCompanySignals(db, companySignalsMatch[1], {
          start: route.searchParams.get("start"),
          end: route.searchParams.get("end"),
          category: route.searchParams.get("category"),
          type: route.searchParams.get("type")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const companyScoresMatch = pathname.match(/^\/api\/v1\/companies\/([^/]+)\/scores$/);
    if (companyScoresMatch && req.method === "GET") {
      const result = withDb((db) =>
        listCompanyScores(db, companyScoresMatch[1], {
          start: route.searchParams.get("start"),
          end: route.searchParams.get("end"),
          type: route.searchParams.get("type")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const industrySignalsMatch = pathname.match(/^\/api\/v1\/industries\/([^/]+)\/signals$/);
    if (industrySignalsMatch && req.method === "GET") {
      const result = withDb((db) =>
        listIndustrySignals(db, industrySignalsMatch[1], {
          start: route.searchParams.get("start"),
          end: route.searchParams.get("end")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const industryScoresMatch = pathname.match(/^\/api\/v1\/industries\/([^/]+)\/scores$/);
    if (industryScoresMatch && req.method === "GET") {
      const result = withDb((db) =>
        listIndustryScores(db, industryScoresMatch[1], {
          start: route.searchParams.get("start"),
          end: route.searchParams.get("end")
        })
      );
      sendJson(res, 200, result);
      return;
    }

    const scoreExplanationMatch = pathname.match(/^\/api\/v1\/scores\/([^/]+)\/explanation$/);
    if (scoreExplanationMatch && req.method === "GET") {
      const result = withDb((db) => getScoreExplanation(db, scoreExplanationMatch[1]));
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`worker-service listening on http://${host}:${port}`);
  if (schedulerState.enabled) {
    runDailyBriefSchedulerTick();
    setInterval(runDailyBriefSchedulerTick, schedulerState.intervalMs);
  }
});
