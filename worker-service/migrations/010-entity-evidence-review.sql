-- Migration 010: Entity linking review queue + explicit evidence pointers

CREATE TABLE IF NOT EXISTS processed_signal_evidence (
    id TEXT PRIMARY KEY,
    processed_signal_id TEXT NOT NULL,
    raw_document_id TEXT,
    raw_record_id TEXT,
    source_url TEXT,
    local_path TEXT,
    query_text TEXT,
    filter_params TEXT,
    retrieval_url TEXT,
    page_number INTEGER,
    range_start DATETIME,
    range_end DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (processed_signal_id) REFERENCES processed_signal(id)
);

CREATE TABLE IF NOT EXISTS entity_mapping_review_queue (
    id TEXT PRIMARY KEY,
    processing_run_id TEXT NOT NULL,
    processing_item_id TEXT NOT NULL,
    processed_signal_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    candidate_entity_name TEXT,
    candidate_uen TEXT,
    confidence REAL NOT NULL,
    threshold REAL NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by_user_id INTEGER,
    resolution_note TEXT,
    FOREIGN KEY (processing_run_id) REFERENCES processing_run(id),
    FOREIGN KEY (processing_item_id) REFERENCES processing_item(id),
    FOREIGN KEY (processed_signal_id) REFERENCES processed_signal(id)
);
