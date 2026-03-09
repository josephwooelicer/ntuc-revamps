-- Migration 006: Replay/retrieval metadata for raw artifacts
-- Adds traceability fields required for reproducible historical backtesting.

ALTER TABLE raw_document ADD COLUMN query_text TEXT;
ALTER TABLE raw_document ADD COLUMN filter_params TEXT;
ALTER TABLE raw_document ADD COLUMN retrieval_url TEXT;
ALTER TABLE raw_document ADD COLUMN page_number INTEGER;
ALTER TABLE raw_document ADD COLUMN range_start DATETIME;
ALTER TABLE raw_document ADD COLUMN range_end DATETIME;

ALTER TABLE raw_record ADD COLUMN query_text TEXT;
ALTER TABLE raw_record ADD COLUMN filter_params TEXT;
ALTER TABLE raw_record ADD COLUMN retrieval_url TEXT;
ALTER TABLE raw_record ADD COLUMN page_number INTEGER;
ALTER TABLE raw_record ADD COLUMN range_start DATETIME;
ALTER TABLE raw_record ADD COLUMN range_end DATETIME;
