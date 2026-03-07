INSERT OR IGNORE INTO data_source (
  id, name, source_type, access_mode, category, reliability_weight, supports_backfill
) VALUES
  ('src-mas', 'MAS Statistics', 'gov', 'scrape', 'macro_labor', 0.90, 1),
  ('src-stb', 'Singapore Tourism Board', 'gov', 'scrape', 'macro_labor', 0.85, 1),
  ('src-mycareersfuture', 'MyCareersFuture', 'gov', 'scrape', 'labor_market', 0.80, 1),
  ('src-sgx', 'SGX Announcements', 'news', 'scrape', 'events_mentions', 0.85, 1),
  ('src-google-trends', 'Google Trends', 'forum', 'scrape', 'public_sentiment', 0.65, 1);
