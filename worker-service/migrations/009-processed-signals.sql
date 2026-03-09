-- Migration 009: Processed signals + shared evaluation matrix for source parsing

ALTER TABLE processing_run ADD COLUMN processed_signals_saved INTEGER DEFAULT 0;
ALTER TABLE processing_run ADD COLUMN processed_signals_skipped INTEGER DEFAULT 0;
ALTER TABLE processing_run ADD COLUMN processed_signals_failed INTEGER DEFAULT 0;

ALTER TABLE processing_item ADD COLUMN processed_signals_saved INTEGER DEFAULT 0;
ALTER TABLE processing_item ADD COLUMN processed_signals_skipped INTEGER DEFAULT 0;
ALTER TABLE processing_item ADD COLUMN processed_signals_failed INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS processed_signal (
    id TEXT PRIMARY KEY,
    processing_run_id TEXT NOT NULL,
    processing_item_id TEXT NOT NULL,
    ingestion_run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    raw_document_id TEXT,
    entity_name TEXT,
    uen TEXT,
    event_type TEXT NOT NULL,
    signal_category TEXT NOT NULL,
    occurred_at DATETIME,
    summary TEXT NOT NULL,
    canonical_url TEXT,
    grouping_key TEXT,
    matrix_version TEXT NOT NULL,
    matrix_scores TEXT NOT NULL, -- JSON
    evaluation_label TEXT NOT NULL, -- positive | neutral | negative | irrelevant
    final_score REAL NOT NULL, -- 0..100 source-consistent scale
    parser_confidence REAL NOT NULL,
    parser_version TEXT NOT NULL,
    evaluator_model TEXT,
    evaluator_reasoning TEXT,
    metadata TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (processing_run_id) REFERENCES processing_run(id),
    FOREIGN KEY (processing_item_id) REFERENCES processing_item(id),
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_run(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_signal_dedup
ON processed_signal (source_id, ingestion_run_id, canonical_url, grouping_key);
