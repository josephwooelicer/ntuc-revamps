PRAGMA foreign_keys = ON;

-- Remove seeded source-dependent artifacts first.
DELETE FROM evidence_pointer
WHERE raw_document_id IN (
  SELECT id FROM raw_document WHERE source_id IN (
    'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
    'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
    'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
    'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
  )
)
OR signal_id IN (
  SELECT id FROM signal WHERE source_id IN (
    'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
    'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
    'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
    'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
  )
);

DELETE FROM signal
WHERE source_id IN (
  'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
  'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
  'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
  'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
);

DELETE FROM raw_document
WHERE source_id IN (
  'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
  'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
  'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
  'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
);

DELETE FROM ingestion_run
WHERE source_id IN (
  'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
  'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
  'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
  'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
);

DELETE FROM data_source
WHERE id IN (
  'src-singstat','src-mom','src-ura','src-acra','src-egazette','src-news','src-reddit-sg','src-hardwarezone',
  'src-mas','src-stb','src-mycareersfuture','src-sgx','src-google-trends','src-worldbank','src-fred',
  'src-singapore-customs','src-jobstreet','src-linkedin-jobs','src-skillsfuture','src-google-maps',
  'src-google-reviews','src-glassdoor','src-company-websites','src-layoffs-fyi'
);

-- Remove seeded companies and direct dependents.
DELETE FROM company_alias
WHERE id IN (
  'alias-hanbaobao-1','alias-hanbaobao-2','alias-kopitiam-tech-1','alias-lion-city-fnb-1','alias-merlion-systems-1'
)
OR source = 'seed'
OR company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

DELETE FROM score_explanation
WHERE score_snapshot_id IN (
  SELECT id FROM score_snapshot WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems')
  OR industry_id IN ('ind-fnb','ind-tech')
);

DELETE FROM score_override
WHERE score_snapshot_id IN (
  SELECT id FROM score_snapshot WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems')
  OR industry_id IN ('ind-fnb','ind-tech')
);

DELETE FROM score_snapshot
WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems')
OR industry_id IN ('ind-fnb','ind-tech');

DELETE FROM on_demand_analysis_job
WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

DELETE FROM evidence_pointer
WHERE signal_id IN (
  SELECT id FROM signal WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems')
);

DELETE FROM signal
WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

DELETE FROM brand_company
WHERE company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

UPDATE entity_resolution
SET reviewed_by = NULL
WHERE reviewed_by IN ('user-admin-001','user-analyst-001','user-officer-001');

UPDATE entity_resolution
SET matched_company_id = NULL
WHERE matched_company_id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

DELETE FROM company
WHERE id IN ('co-hanbaobao','co-kopitiam-tech','co-lion-city-fnb','co-merlion-systems');

DELETE FROM industry
WHERE id IN ('ind-fnb','ind-tech');

-- Remove seeded config/recommendations.
DELETE FROM config_item
WHERE key IN (
  'industry_stress_gate_threshold',
  'industry_adjustment_weight',
  'high_risk_alert_threshold',
  'emerging_risk_delta_threshold',
  'emerging_risk_score_ceiling',
  'entity_auto_resolve_threshold',
  'time_decay_enabled',
  'time_decay_weights',
  'industry_baseline_months',
  'company_baseline_months',
  'daily_brief_ready_by_sgt'
);

UPDATE model_recommendation
SET decided_by = NULL
WHERE decided_by IN ('user-admin-001','user-analyst-001','user-officer-001');

DELETE FROM model_recommendation
WHERE id IN ('mr-industry-default','mr-company-default');

-- Remove seeded role permissions.
DELETE FROM role_permission
WHERE (role = 'analyst' AND permission IN ('industry.score.override','industry.settings.update','industry.recommendation.approve'))
   OR (role = 'officer' AND permission IN ('company.score.override','company.settings.update','company.recommendation.approve','entity.mapping.approve'))
   OR (role = 'admin' AND permission IN ('source.manage','ops.manage'));

-- Remove seeded users after nulling references.
UPDATE audit_log
SET actor_user_id = NULL
WHERE actor_user_id IN ('user-admin-001','user-analyst-001','user-officer-001');

UPDATE score_override
SET created_by = NULL
WHERE created_by IN ('user-admin-001','user-analyst-001','user-officer-001');

UPDATE on_demand_analysis_job
SET created_by = NULL
WHERE created_by IN ('user-admin-001','user-analyst-001','user-officer-001');

DELETE FROM app_user
WHERE id IN ('user-admin-001','user-analyst-001','user-officer-001');
