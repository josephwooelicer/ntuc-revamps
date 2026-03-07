INSERT OR IGNORE INTO data_source (
  id, name, source_type, access_mode, category, reliability_weight, supports_backfill
) VALUES
  ('src-layoffs-fyi', 'layoffs.fyi', 'news', 'scrape', 'events_mentions', 0.70, 1);
