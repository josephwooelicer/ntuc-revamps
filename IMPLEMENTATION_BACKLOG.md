# NTUC EWS Implementation Backlog

This document outlines the phased implementation roadmap for the NTUC Retrenchment Early Warning System (EWS).

---

## [Epic 0] Local Bootstrap
**Goal**: Establish a reproducible local development and runtime environment.
- [x] Next.js web platform scaffold (Epic 0 baseline).
- [x] Worker service scaffold (SQLite + filesystem checks).
- [x] Local bootstrap scripts (`setup`, `dev`, `health`).
- [x] Health check endpoints and data-lake directory structure.

**Isolated Testing**:
- Run `npm run health` to verify Next.js and worker process connectivity.
- Verify `./data-lake/raw` creation on setup.

## [Epic 1] Core Data Model + Audit
**Goal**: Build the persistence layer and security/accountability foundations.
- [x] SQL migrations (SQLite) using `.sql` files and a custom script (`migrate.ts`) to track and apply structural/seed data changes.
- [x] Audit trail infrastructure for logging all critical mutations.
- [x] API hooks for overrides, config changes, and model recommendations.
- [x] Initial role-based access control (Analyst, Officer, Admin).

**Isolated Testing**:
- Manual API testing via `curl` to `POST /api/v1/overrides` and verifying `audit_log` entry in SQLite.
- Run `npm run db:status` to verify migration version.

## [Epic 2] Ingestion Framework + Connectors
**Goal**: Build the modular engine for retrieving data from diverse external sources.
- [x] Source registry with reliability weights and categories.
- [x] Modular connector pattern with `pull(range, cursor)` capability.
- [x] `data.gov.sg` connector via Playwright (34 agencies, specific URL params).
- [x] News, Reddit, and HardwareZone connectors via Playwright-based Google Search scraping (3 pages, month-by-month).
- [x] `layoffs.fyi` tech-only connector via direct Airtable scraping.
- [x] `eGazette` search-based connector for company-specific liquidation notices.

**Isolated Testing**:
- Use `POST /api/v1/ingestion/backfill/news` with short date range and verify local files in `data-lake/raw`.
- Run `curl -s http://127.0.0.1:4000/api/v1/sources` to verify registry metadata.

## [Epic 3] Entity Resolution Service
**Goal**: Match messy external mentions to clean legal entities (UENs).
- [x] Matching pipeline with exact, alias, and fuzzy strategies.
- [x] UEN retrieval logic from `https://www.bizfile.gov.sg` entity search via `playwright`.
- [x] Manual review queue for low-confidence mappings.
- [x] Alias learning and persistence from manual analyst approvals.

**Isolated Testing**:
- Trigger `/api/v1/entity-resolution/resolve` for a specific run and check the `review-queue` API output.
- Perform a manual approval and verify `alias` persistence in the `company_aliases` table.

## [Epic 4] Signal Processing Engine
**Goal**: Convert raw text/data into standardized signals and features.
- [ ] Extraction logic for trend detection (gradual) and event detection (sudden).
- [ ] Sentiment analysis engine for forum/news content.
- [ ] Cleaning, parsing, and normalization (Z-score) of raw signals.
- [ ] Category-aware feature preparation for the scoring service.

**Isolated Testing**:
- Unit test extraction logic with mock HTML/JSON payloads.
- Verify feature generation for a single UEN without running the full ingestion pipeline.

## [Epic 5] Feature Store
**Goal**: Centralized storage for features and their evidence trails.
- [ ] Standardized feature persistence (value, timestamp, confidence).
- [ ] Evidence pointer storage linking scores back to original raw documents.
- [ ] API for scoring service to efficiently retrieve historical feature snapshots.

**Isolated Testing**:
- Query feature store APIs for a specific UEN and date to verify data integrity and evidence pointers.

## [Epic 6] Risk Scoring Service
**Goal**: Implement the core early warning math and combination logic.
- [ ] Industry Risk Score calculation (monthly).
- [ ] Company Signals Score calculation (weekly).
- [ ] Gated combination logic (Industry stress impacting Company scores).
- [ ] Delta calculation (score changes since previous assessment).

**Isolated Testing**:
- Run scoring logic on a fixed set of features in the feature store and verify against expected score (Excel baseline).

## [Epic 7] Briefing + Alerting
**Goal**: Deliver actionable insights to users.
- [x] Daily morning brief generation (06:00 SGT).
- [x] High-risk detections, industry clusters, and major event summaries.
- [x] Emerging risk watchlist (rapidly rising scores below alert threshold).
- [ ] Notification delivery (Email/In-app).

**Isolated Testing**:
- Trigger `POST /api/v1/briefs/generate` for a past date and verify the JSON payload in the `morning_brief` table.

## [Epic 8] Web Platform & Dashboards
**Goal**: Provide a premium user interface for analysts and officers.
- [ ] Industry Dashboard for Analysts (sector-wide stress).
- [ ] Company Dashboard for Officers (specific case deep-dives).
- [ ] On-demand Search & Analysis tool (immediate ingestion + scoring).
- [ ] Evidence viewer showing signal context and grounding sources.

**Isolated Testing**:
- Component-level tests for dashboards using mock API data.
- Verify on-demand report generation UI with a test company.

## [Epic 9] Configuration & Administrative Interface
**Goal**: Empower users to tune the system.
- [ ] Settings UI for adjusting category/source weights and time decay.
- [ ] Threshold management (gating, alerts, emerging risk).
- [ ] Operational monitoring for connectors and worker queues.

**Isolated Testing**:
- Verify that updating a weight in the UI immediately reflects in subsequent API calls to `POST /api/v1/config`.

## [Epic 10] Model Training & AI Feedback
**Goal**: Periodically improve the system based on outcomes and human feedback.
- [ ] Automated log analysis for override patterns.
- [ ] AI-driven recommendation engine for suggested weight adjustments.
- [ ] Training pipeline for periodic (monthly) model improvement.

**Isolated Testing**:
- Run recommendation engine on a dump of `audit_log` overrides and verify suggested weight changes.
