INSERT OR IGNORE INTO app_user (id, email, role) VALUES
  ('user-admin-001', 'admin@ntuc.local', 'admin'),
  ('user-analyst-001', 'analyst@ntuc.local', 'analyst'),
  ('user-officer-001', 'officer@ntuc.local', 'officer');

INSERT OR IGNORE INTO role_permission (role, permission) VALUES
  ('analyst', 'industry.score.override'),
  ('analyst', 'industry.settings.update'),
  ('analyst', 'industry.recommendation.approve'),
  ('officer', 'company.score.override'),
  ('officer', 'company.settings.update'),
  ('officer', 'company.recommendation.approve'),
  ('officer', 'entity.mapping.approve'),
  ('admin', 'source.manage'),
  ('admin', 'ops.manage');

INSERT OR IGNORE INTO industry (id, code, name) VALUES
  ('ind-fnb', 'FNB', 'Food and Beverage'),
  ('ind-tech', 'TECH', 'Technology');

INSERT OR IGNORE INTO data_source (id, name, source_type, access_mode, reliability_weight, supports_backfill) VALUES
  ('src-singstat', 'SingStat', 'gov', 'api', 0.95, 1),
  ('src-mom', 'MOM', 'gov', 'api', 0.95, 1),
  ('src-ura', 'URA Rental Index', 'gov', 'api', 0.95, 1),
  ('src-acra', 'ACRA', 'gov', 'api', 0.90, 0),
  ('src-egazette', 'eGazette', 'gov', 'api', 0.90, 1),
  ('src-news', 'News Aggregator', 'news', 'scrape', 0.75, 1),
  ('src-reddit-sg', 'Reddit Singapore', 'forum', 'api', 0.55, 1),
  ('src-hardwarezone', 'HardwareZone', 'forum', 'scrape', 0.50, 1);

INSERT OR IGNORE INTO config_item (key, value, scope, updated_by) VALUES
  ('industry_stress_gate_threshold', '60', 'industry', 'user-analyst-001'),
  ('industry_adjustment_weight', '0.30', 'industry', 'user-analyst-001'),
  ('high_risk_alert_threshold', '70', 'company', 'user-officer-001'),
  ('emerging_risk_delta_threshold', '10', 'company', 'user-officer-001'),
  ('emerging_risk_score_ceiling', '70', 'company', 'user-officer-001'),
  ('entity_auto_resolve_threshold', '0.85', 'company', 'user-officer-001'),
  ('time_decay_enabled', 'true', 'global', 'user-admin-001'),
  ('time_decay_weights', '{"weekly":0.7,"monthly":0.3}', 'global', 'user-admin-001'),
  ('industry_baseline_months', '24', 'industry', 'user-analyst-001'),
  ('company_baseline_months', '12', 'company', 'user-officer-001'),
  ('daily_brief_ready_by_sgt', '06:00', 'global', 'user-admin-001');

INSERT OR IGNORE INTO model_recommendation (id, scope, recommendation, status) VALUES
  ('mr-industry-default', 'industry', '{"message":"No recommendation yet"}', 'pending'),
  ('mr-company-default', 'company', '{"message":"No recommendation yet"}', 'pending');
