-- Migration 007: Idempotency counters and dedup support

ALTER TABLE ingestion_run ADD COLUMN documents_saved INTEGER DEFAULT 0;
ALTER TABLE ingestion_run ADD COLUMN records_saved INTEGER DEFAULT 0;
ALTER TABLE ingestion_run ADD COLUMN duplicates_skipped INTEGER DEFAULT 0;
