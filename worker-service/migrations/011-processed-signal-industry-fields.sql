-- Migration 011: Industry-level fields on processed signals

ALTER TABLE processed_signal ADD COLUMN signal_level TEXT DEFAULT 'company'; -- company | industry
ALTER TABLE processed_signal ADD COLUMN impacted_industries TEXT; -- JSON array of industries
