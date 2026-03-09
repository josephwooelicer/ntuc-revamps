-- Ingestion Framework Tables

-- Redefine sources table (since 001-initial-schema is already there, we use ALTER/DROP tricks if needed, or just table changes if we use a fresh DB)
-- Since the DB is recreated on `npm run setup`, we can DROP TABLE sources and recreate it
DROP TABLE IF EXISTS sources;

CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    accessMode TEXT NOT NULL,
    category TEXT NOT NULL,
    reliabilityWeight REAL DEFAULT 1.0,
    supportsBackfill BOOLEAN DEFAULT 0,
    isActive BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ingestion_run (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pending', 'success', 'failed'
    range_start DATETIME,
    range_end DATETIME,
    records_pulled INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS raw_document (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    external_id TEXT,
    title TEXT,
    url TEXT,
    fetched_at DATETIME NOT NULL,
    published_at DATETIME,
    local_path TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES ingestion_run(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);
