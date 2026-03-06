INSERT OR IGNORE INTO company (id, uen, registered_name, industry_id, is_active) VALUES
  ('co-hanbaobao', '198400001M', 'Hanbaobao Pte Ltd', 'ind-fnb', 1),
  ('co-kopitiam-tech', '201122233D', 'Kopitiam Digital Technologies Pte Ltd', 'ind-tech', 1),
  ('co-lion-city-fnb', '201455566K', 'Lion City Foods Pte Ltd', 'ind-fnb', 1),
  ('co-merlion-systems', '201788899R', 'Merlion Systems Pte Ltd', 'ind-tech', 1);

INSERT OR IGNORE INTO company_alias (id, company_id, alias, source) VALUES
  ('alias-hanbaobao-1', 'co-hanbaobao', 'McDonald''s Singapore', 'seed'),
  ('alias-hanbaobao-2', 'co-hanbaobao', 'McDonald''s', 'seed'),
  ('alias-kopitiam-tech-1', 'co-kopitiam-tech', 'KopiTech', 'seed'),
  ('alias-lion-city-fnb-1', 'co-lion-city-fnb', 'Lion City Foods', 'seed'),
  ('alias-merlion-systems-1', 'co-merlion-systems', 'Merlion Systems', 'seed');
