INSERT OR IGNORE INTO data_source (
  id, name, source_type, access_mode, category, reliability_weight, supports_backfill
) VALUES
  ('src-worldbank', 'World Bank API', 'gov', 'api', 'macro_labor', 0.80, 1),
  ('src-fred', 'FRED API', 'gov', 'api', 'macro_labor', 0.75, 1),
  ('src-singapore-customs', 'Singapore Customs', 'gov', 'scrape', 'industry_cost_pressure', 0.85, 1),
  ('src-jobstreet', 'JobStreet', 'forum', 'scrape', 'labor_market', 0.70, 1),
  ('src-linkedin-jobs', 'LinkedIn Jobs', 'forum', 'scrape', 'labor_market', 0.70, 1);
