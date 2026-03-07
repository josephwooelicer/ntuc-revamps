INSERT OR IGNORE INTO data_source (
  id, name, source_type, access_mode, category, reliability_weight, supports_backfill
) VALUES
  ('src-skillsfuture', 'SkillsFuture', 'gov', 'scrape', 'labor_market', 0.80, 1),
  ('src-google-maps', 'Google Maps Places', 'forum', 'api', 'operational_signals', 0.70, 1),
  ('src-google-reviews', 'Google Reviews', 'forum', 'api', 'public_sentiment', 0.65, 1),
  ('src-glassdoor', 'Glassdoor', 'forum', 'scrape', 'public_sentiment', 0.60, 1),
  ('src-company-websites', 'Company Websites', 'news', 'scrape', 'operational_signals', 0.75, 1);
