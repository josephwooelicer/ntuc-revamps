import fs from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./db/migrate.js";
import { openDb, getDbPath } from "./db/client.js";
import { insertAuditLog } from "./db/audit.js";
import { resolveRepoPath } from "./lib/paths.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT_WORKER || 4000);
const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
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

function reviewEntityResolution(resolutionId, body) {
  const { status, matchedCompanyId, actorUserId, method } = body;
  if (!status || !["approved", "rejected"].includes(status)) {
    throw new Error("status must be one of: approved, rejected");
  }

  return withDb((db) => {
    const before = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);
    if (!before) {
      throw new Error("entity_resolution not found");
    }

    db.exec("BEGIN;");
    try {
      db
        .prepare(
          `UPDATE entity_resolution
           SET status = ?,
               matched_company_id = COALESCE(?, matched_company_id),
               method = COALESCE(?, method),
               reviewed_by = ?,
               reviewed_at = current_timestamp
           WHERE id = ?`
        )
        .run(status, matchedCompanyId || null, method || null, actorUserId || null, resolutionId);

      const after = db.prepare("SELECT * FROM entity_resolution WHERE id = ?").get(resolutionId);

      insertAuditLog(db, {
        actorUserId,
        action: "entity_resolution.reviewed",
        entityType: "entity_resolution",
        entityId: resolutionId,
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
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, checkHealth());
      return;
    }

    if (req.method === "POST" && req.url === "/api/v1/overrides") {
      const body = await readJsonBody(req);
      const result = applyScoreOverride(body);
      sendJson(res, 201, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/v1/config") {
      const body = await readJsonBody(req);
      const result = upsertConfig(body);
      sendJson(res, 200, result);
      return;
    }

    const recommendationMatch = req.url?.match(/^\/api\/v1\/model-recommendations\/([^/]+)\/decision$/);
    if (req.method === "POST" && recommendationMatch) {
      const body = await readJsonBody(req);
      const result = decideModelRecommendation(recommendationMatch[1], body);
      sendJson(res, 200, result);
      return;
    }

    const entityReviewMatch = req.url?.match(/^\/api\/v1\/entity-resolution\/([^/]+)\/review$/);
    if (req.method === "POST" && entityReviewMatch) {
      const body = await readJsonBody(req);
      const result = reviewEntityResolution(entityReviewMatch[1], body);
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
