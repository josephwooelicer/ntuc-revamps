# NTUC EWS Implementation Backlog

This document outlines the phased implementation roadmap for the NTUC Retrenchment Early Warning System (EWS).

---

## [Epic 0] Local Bootstrap
**Goal**: Establish a reproducible local development and runtime environment.
- [x] Next.js web platform scaffold (Epic 0 baseline).
- [x] Worker service scaffold (SQLite + filesystem checks).
- [x] Local bootstrap scripts (`setup`, `dev`, `health`).
- [x] Health check endpoints and data-lake directory structure.


## [Epic 1] Core Data Model + Audit
**Goal**: Build the persistence layer and security/accountability foundations.
- [x] SQL migrations (SQLite) using `.sql` files and a custom script (`migrate.ts`) to track and apply structural/seed data changes.
- [x] Audit trail infrastructure for logging all critical mutations.
- [x] API hooks for overrides, config changes, and model recommendations.
- [x] Initial role-based access control (Analyst, Officer, Admin).


## [Epic 2] Ingestion Framework + Connectors
**Goal**: Build the modular engine for retrieving data from diverse external sources.
- [x] Source registry with reliability weights and categories.
- [x] Modular connector pattern with `pull(range, cursor)` capability.
- [x] `data.gov.sg` connector via Playwright (34 agencies, specific URL params).
- [x] News, Reddit, and HardwareZone connectors via Playwright-based Google Search scraping (3 pages, month-by-month).
- [x] `layoffs.fyi` tech-only connector via direct Airtable scraping.
- [x] `eGazette` search-based connector for company-specific liquidation notices.


## [Epic 3] Entity Relationship Mapping
**Goal**: Identify and link related entities to provide a comprehensive view of the searched target.
- [x] Find all relevant entities to the searched entity.

## [Epic 4] Raw Data Retrieval
**Goal**: Comprehensive data collection for targeted entities across all configured sources.
- [ ] Automated retrieval of raw data from all connectors for identified entities.
- [ ] Implementation of date-range filtering for comprehensive historical context.

## [Epic 5] Data Processing & Persistence
**Goal**: Transform raw data into structured insights and maintain traceability.
- [ ] Processing and deduplication of retrieved data.
- [ ] Storage into the database with mapping/pointers to original raw sources for auditability.

## [Epic 6] Risk Scoring Engine
**Goal**: Quantify retrenchment risk using multi-factor signals.
- [ ] Implementation of the core risk scoring algorithm.
- [ ] Integration of sentiment signals and financial indicators into the score.

## [Epic 7] Entity Investigation Interface
**Goal**: Provide a detailed investigation report for specific companies.
- [ ] Web interface for searching a company by name and date.
- [ ] Real-time execution of Epics 4, 5, and 6 to generate an instant report.

## [Epic 8] Analyst Override System
**Goal**: Allow human expertise to refine automated scores.
- [ ] Feature to manually override risk scores.
- [ ] Auditing and logging of all manual score adjustments.

## [Epic 9] Executive Dashboard
**Goal**: High-level visualization of systemic risks and trends.
- [ ] Aggregate risk views across sectors and periods.
- [ ] Critical alert summaries and "top at-risk" company leaderboards.

## [Epic 10] Administration & Configuration
**Goal**: Manage system settings, users, and source reliability.
- [ ] Settings page for system-wide configurations.
- [ ] Admin interface for managing user roles and source registry weights.

## [Epic 11] Proactive Alerts & Reporting
**Goal**: Deliver timely insights to stakeholders.
- [ ] Daily brief generation for specific sectors.
- [ ] Real-time alerting for high-risk threshold breaches.

## [Epic 12] Model Optimization & Feedback
**Goal**: Continuous improvement of the warning system.
- [ ] Model training cycles based on historical outcomes.
- [ ] AI feedback loop to refine scoring logic based on analyst adjustments.


