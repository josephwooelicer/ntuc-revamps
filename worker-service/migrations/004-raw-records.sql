-- Migration 004: Raw Record Table
-- Stores non-file (JSON) data retrieved by connectors.

CREATE TABLE IF NOT EXISTS raw_record (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    external_id TEXT,
    data TEXT NOT NULL, -- JSON string
    fetched_at DATETIME NOT NULL,
    published_at DATETIME,
    FOREIGN KEY (run_id) REFERENCES ingestion_run(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);
