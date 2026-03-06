import fs from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./db/migrate.js";
import { openDb, getDbPath } from "./db/client.js";
import { insertAuditLog } from "./db/audit.js";
import { resolveRepoPath } from "./lib/paths.js";
import { createSource, listSources } from "./ingestion/sourceRegistry.js";
import { fetchIngestionRun, runBackfillNews, runIngestion } from "./ingestion/service.js";
import {
  addCompanyAlias,
  approveEntityResolution,
  listCompanyAliases,
  listReviewQueue,
  rejectEntityResolution,
  resolveEntities
} from "./entity-resolution/service.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT_WORKER || 4000);
const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";

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
    scheduler: "idle",
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

function applyScoreOverride(body) {
  const { scoreSnapshotId, overriddenScore, reason, scope, actorUserId } = body;
  if (!scoreSnapshotId || overriddenScore == null || !reason || !scope) {
    throw new Error("Missing required fields: scoreSnapshotId, overriddenScore, reason, scope");
  }

  return withDb((db) => {
    const snapshot = db
      .prepare("SELECT id, score_value FROM score_snapshot WHERE id = ?")
      .get(scoreSnapshotId);

    if (!snapshot) {
      throw new Error("score_snapshot not found");
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
        actorUserId,
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
        actorUserId,
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

runMigrations();

const server = http.createServer(async (req, res) => {
  try {
    const route = routePath(req);
    const { pathname } = route;

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, checkHealth());
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

    if (req.method === "POST" && pathname === "/api/v1/config") {
      const body = await readJsonBody(req);
      const result = upsertConfig(body);
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

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`worker-service listening on http://${host}:${port}`);
});
