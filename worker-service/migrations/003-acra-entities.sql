CREATE TABLE IF NOT EXISTS acra_entities (
    uen TEXT PRIMARY KEY,
    entity_name TEXT NOT NULL,
    entity_type TEXT,
    status TEXT,
    registration_date TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acra_entity_name ON acra_entities(entity_name);
