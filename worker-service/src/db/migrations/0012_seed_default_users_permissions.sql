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
