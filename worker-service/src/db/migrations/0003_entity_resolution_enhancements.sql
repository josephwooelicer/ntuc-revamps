ALTER TABLE entity_resolution ADD COLUMN matched_alias TEXT;
ALTER TABLE entity_resolution ADD COLUMN reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_resolution_raw_document ON entity_resolution(raw_document_id);
