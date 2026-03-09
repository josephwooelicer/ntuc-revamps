-- Migration 008: Processing pipeline run tracking

CREATE TABLE IF NOT EXISTS processing_run (
    id TEXT PRIMARY KEY,
    run_mode TEXT NOT NULL, -- debug_on_demand | production
    ingestion_orchestration_run_id TEXT,
    range_start DATETIME,
    range_end DATETIME,
    status TEXT NOT NULL, -- running | success | partial | failed
    ingestion_runs_targeted INTEGER DEFAULT 0,
    ingestion_runs_processed INTEGER DEFAULT 0,
    raw_documents_seen INTEGER DEFAULT 0,
    raw_records_seen INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (ingestion_orchestration_run_id) REFERENCES ingestion_orchestration_run(id)
);

CREATE TABLE IF NOT EXISTS processing_item (
    id TEXT PRIMARY KEY,
    processing_run_id TEXT NOT NULL,
    ingestion_run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL, -- running | success | failed
    raw_documents_seen INTEGER DEFAULT 0,
    raw_records_seen INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (processing_run_id) REFERENCES processing_run(id),
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_run(id)
);
