-- Migration 005: Orchestrated ingestion run tracking
-- Parent run groups one scoped request; child rows track each connector execution.

CREATE TABLE IF NOT EXISTS ingestion_orchestration_run (
    id TEXT PRIMARY KEY,
    run_mode TEXT NOT NULL, -- debug_on_demand | production
    company_name TEXT,
    uen TEXT,
    industry TEXT,
    range_start DATETIME NOT NULL,
    range_end DATETIME NOT NULL,
    status TEXT NOT NULL, -- running | success | partial | failed
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_orchestration_item (
    id TEXT PRIMARY KEY,
    orchestration_run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    ingestion_run_id TEXT,
    status TEXT NOT NULL, -- pending | running | success | failed | skipped
    records_pulled INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (orchestration_run_id) REFERENCES ingestion_orchestration_run(id)
);
