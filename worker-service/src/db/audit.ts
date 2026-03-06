import { randomUUID } from "node:crypto";

export function insertAuditLog(db, { actorUserId, action, entityType, entityId, beforeState, afterState }) {
  db
    .prepare(
      `INSERT INTO audit_log (
        id, actor_user_id, action, entity_type, entity_id, before_state, after_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      actorUserId || null,
      action,
      entityType,
      entityId,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null
    );
}
