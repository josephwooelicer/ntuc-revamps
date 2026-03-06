PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migration (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('analyst','officer','admin')),
  created_at TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS role_permission (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS industry (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  uen TEXT UNIQUE NOT NULL,
  registered_name TEXT NOT NULL,
  industry_id TEXT REFERENCES industry(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS brand (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_company (
  brand_id TEXT REFERENCES brand(id),
  company_id TEXT REFERENCES company(id),
  PRIMARY KEY (brand_id, company_id)
);

CREATE TABLE IF NOT EXISTS company_alias (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES company(id),
  alias TEXT NOT NULL,
  source TEXT NOT NULL,
  UNIQUE(company_id, alias)
);

CREATE TABLE IF NOT EXISTS data_source (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  source_type TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  reliability_weight NUMERIC(5,4) NOT NULL DEFAULT 0.7000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  supports_backfill BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES data_source(id),
  run_type TEXT NOT NULL,
  range_start TEXT,
  range_end TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT current_timestamp,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS raw_document (
  id TEXT PRIMARY KEY,
  ingestion_run_id TEXT REFERENCES ingestion_run(id),
  source_id TEXT REFERENCES data_source(id),
  external_id TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT current_timestamp,
  title TEXT,
  url TEXT,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  pii_masked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS entity_resolution (
  id TEXT PRIMARY KEY,
  raw_document_id TEXT REFERENCES raw_document(id),
  matched_company_id TEXT REFERENCES company(id),
  confidence NUMERIC(5,4) NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewed_by TEXT REFERENCES app_user(id),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS signal (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES company(id),
  industry_id TEXT REFERENCES industry(id),
  source_id TEXT REFERENCES data_source(id),
  signal_type TEXT NOT NULL,
  category TEXT NOT NULL,
  signal_ts TEXT NOT NULL,
  raw_value NUMERIC,
  z_value NUMERIC,
  reliability_weight NUMERIC(5,4),
  decay_weight NUMERIC(5,4),
  weighted_value NUMERIC,
  confidence NUMERIC(5,4)
);

CREATE TABLE IF NOT EXISTS evidence_pointer (
  id TEXT PRIMARY KEY,
  signal_id TEXT REFERENCES signal(id),
  raw_document_id TEXT REFERENCES raw_document(id),
  snippet TEXT,
  pointer_url TEXT
);

CREATE TABLE IF NOT EXISTS score_snapshot (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES company(id),
  industry_id TEXT REFERENCES industry(id),
  score_type TEXT NOT NULL,
  period_type TEXT NOT NULL,
  score_date DATE NOT NULL,
  score_value NUMERIC(5,2) NOT NULL CHECK (score_value BETWEEN 0 AND 100),
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT current_timestamp,
  UNIQUE(company_id, industry_id, score_type, score_date)
);

CREATE TABLE IF NOT EXISTS score_explanation (
  id TEXT PRIMARY KEY,
  score_snapshot_id TEXT REFERENCES score_snapshot(id),
  ordered_contributions TEXT NOT NULL,
  delta_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS score_override (
  id TEXT PRIMARY KEY,
  score_snapshot_id TEXT REFERENCES score_snapshot(id),
  original_score NUMERIC(5,2) NOT NULL,
  overridden_score NUMERIC(5,2) NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_by TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS config_item (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  scope TEXT NOT NULL,
  updated_by TEXT REFERENCES app_user(id),
  updated_at TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS model_recommendation (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT current_timestamp,
  decided_by TEXT REFERENCES app_user(id),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS morning_brief (
  id TEXT PRIMARY KEY,
  brief_date DATE UNIQUE NOT NULL,
  generated_at TEXT NOT NULL DEFAULT current_timestamp,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES app_user(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  created_at TEXT NOT NULL DEFAULT current_timestamp
);
