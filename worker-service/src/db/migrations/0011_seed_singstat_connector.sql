INSERT OR IGNORE INTO data_source (
  id,
  name,
  source_type,
  access_mode,
  category,
  reliability_weight,
  is_active,
  supports_backfill
) VALUES (
  'src-singstat',
  'SingStat',
  'gov',
  'api+scrape',
  'macro_labor',
  0.95,
  1,
  1
);
