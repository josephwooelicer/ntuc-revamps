import { createSingstatConnector } from "../connectors/singstat.js";

export function listSources(db) {
  return db
    .prepare(
      `SELECT id, name, source_type, access_mode, category, reliability_weight, is_active, supports_backfill
       FROM data_source
       ORDER BY name`
    )
    .all();
}

export function getSourceById(db, sourceId) {
  return db
    .prepare(
      `SELECT id, name, source_type, access_mode, category, reliability_weight, is_active, supports_backfill
       FROM data_source
       WHERE id = ?`
    )
    .get(sourceId);
}

export function createSource(db, body) {
  const {
    id,
    name,
    sourceType,
    accessMode,
    category,
    reliabilityWeight,
    supportsBackfill
  } = body;

  if (!id || !name || !sourceType || !accessMode) {
    throw new Error("Missing required fields: id, name, sourceType, accessMode");
  }

  db
    .prepare(
      `INSERT INTO data_source (
          id, name, source_type, access_mode, category, reliability_weight, supports_backfill
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      sourceType,
      accessMode,
      category || "general",
      reliabilityWeight == null ? 0.7 : Number(reliabilityWeight),
      supportsBackfill ? 1 : 0
    );

  return getSourceById(db, id);
}

export function connectorForSource(source) {
  if (!source?.id) return null;
  if (source.id === "src-singstat") {
    return createSingstatConnector();
  }
  return null;
}
