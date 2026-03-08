CREATE TABLE IF NOT EXISTS on_demand_analysis_job (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES company(id),
  query TEXT,
  status TEXT NOT NULL,
  report_path TEXT,
  error TEXT,
  created_by TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT current_timestamp,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_on_demand_analysis_job_status ON on_demand_analysis_job(status);
CREATE INDEX IF NOT EXISTS idx_on_demand_analysis_job_created_at ON on_demand_analysis_job(created_at DESC);
