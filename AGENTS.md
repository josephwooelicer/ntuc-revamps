# AGENTS.md — NTUC Retrenchment Early Warning System (EWS)
_For OpenAI Codex / engineering agents_

This document captures **all agreed design decisions** for the Singapore-focused NTUC project to detect anomalies and forecast company retrenchment risk using a **top-down approach**: **Industry → Company → Final Score**, with human-in-the-loop controls and explainability.

---

## 1) Purpose & Users

### Goal
Build an **AI-driven Early Warning System** for Singapore that:
- Monitors **industry** conditions (monthly) and **company** conditions (weekly)
- Detects early signals of potential retrenchment
- Produces explainable **risk scores** (score doubles as probability estimate)
- Delivers **daily morning briefs** + dashboards for action

### Primary users
- **Analysts**: monitor industries, tune weights, review entity mappings, handle false alarms at industry level
- **Officers**: investigate company cases, review evidence, handle false alarms at company level
- **Admins**: manage sources/connectors, configs, operations health

### Philosophy (operating principle)
- Prefer **higher recall / more false alarms**.
- Humans (analyst/officer) will **tone down** cases as needed.
- Model learns over time via **overrides + outcomes** and recommends weight updates.

---

## 2) Scoring Outputs & Interpretation

### Outputs (must show breakdown)
1. **Industry Risk Score** (monthly)
2. **Company Signals Score** (weekly; company-only features)
3. **Final Company Risk Score** (weekly; combines company + industry context)

**Explainability requirement**
- Show **all contributing signals** ordered by **severity/impact**
- Provide **detailed explanation** per signal
- Include **grounding sources** (links/evidence pointers)
- Show **delta**: what changed since previous assessment + what new data was considered

### Risk score as probability
- No separate probability output.
- **Risk score = probability estimate** (0–100 scale).

---

## 3) Industry ↔ Company Combination Logic

### Industry affects company (YES)
- Company score is affected by industry conditions.
- The system must show the breakdown between:
  - Industry score
  - Company signals score
  - Any adjustment
  - Final score

### Combination rule (GATED)
- Use a **gated rule**: industry contributes only when industry stress is significant.

Conceptual:
- If IndustryRisk < threshold → Final = CompanySignalsScore
- If IndustryRisk ≥ threshold → Final = CompanySignalsScore + IndustryAdjustment

Parameters:
- Industry stress threshold (configurable)
- Industry adjustment weight (configurable)

---

## 4) Time Granularity & Baselines

### Analysis interval (HYBRID)
- **Industry**: **monthly**
- **Company + sentiment**: **weekly**

### Baseline history window (HYBRID)
- **Industry**: **24 months**
- **Company + sentiment**: **12 months**

### Signal normalization
- **Z-score** for internal standardization.
- Display formatting (e.g., 0–100) can be adjusted later for UX, but internal normalization is Z-score.

---

## 5) Weighting & Sensitivity Controls (User-configurable)

### Source reliability weighting (YES)
- Default weights based on source reliability
- Users can edit in settings
- Examples: gov data higher, forums lower

### Time decay (YES)
- Enabled by default
- Users can disable
- Users can set decay weights if enabled

### Category weighting (YES)
- Categories have weights (user-configurable)
- Default weights provided; adjustable by analysts

---

## 6) Signal Detection Modes

Signals must be detected using **two separate engines**:
1. **Trend detection** (gradual deterioration)
2. **Event detection** (sudden shocks)

Both contribute to scoring and explanations.

---

## 7) Monitoring & Briefing

### Daily Morning Brief (YES)
- Delivered daily (morning)
- Sections:
  1) High risk companies
  2) Industries under stress
  3) Major events detected
  4) **Watchlist**: Emerging risk companies (lower priority)

### Emerging risk (YES)
- Detect companies with rapid risk increases even if below high-risk threshold
- Include in brief **at bottom** as a watchlist

### Industry stress clusters (YES)
- Detect clusters of companies under stress within the same industry
- Include in industry dashboard and brief

### Geographic clusters (NO)
- Do not implement geographic clustering; focus on industry and company signals

---

## 8) Coverage & On-demand Analysis

### Coverage scope
- Monitor **all companies in Singapore** (as available through registry + signals)

### On-demand company analysis (YES)
- User can search a company and trigger immediate data pull + scoring on demand
- Must collect all relevant signals and produce a report with breakdown + evidence

---

## 9) Human-in-the-loop Controls

### Manual overrides (YES)
- Analysts/officers can override scores
- Must log:
  - original model score
  - overridden score
  - user, timestamp, reason
- Preserve original score for audit

### AI recommendations for weights (YES)
- If repeated overrides show patterns, AI recommends adjusting weights for contributing reasons
- Recommendations require human approval

---

## 10) Data Ingestion & Extensibility

### Modular ingestion (critical)
- Ingestion must be modular so NTUC can add sources in the future.
- When new source is added, system should:
  1) Ingest sample data
  2) **AI-assisted category classification**
  3) Analyst confirms category
  4) Source enters pipeline

### Raw data storage (YES)
- Store raw ingested data for audit and reprocessing:
  - **Data Lake** for raw objects
  - DB for ingestion metadata

### Ingestion mode (HYBRID)
- Scheduled batch jobs + event-driven triggers

### Connectors (YES)
- Each source has a modular connector.
- Connectors write raw data to Data Lake + emit tasks for downstream processing.

---

## 11) Processing Architecture Decisions

### Signal Processing Engine (YES)
- Dedicated service that converts raw data → standardized signals/features
- Performs:
  - cleaning/parsing
  - entity mention extraction
  - calls entity resolver
  - trend/event detection
  - z-score normalization
  - reliability weights + decay weights preparation
  - writes features to feature store + evidence pointers

### Scaling approach (YES)
- Queue-based worker system
- **Multiple queues based on extractor type**, not by source

Example queues:
- official_stats_extractor
- registry_filings_extractor
- job_market_extractor
- news_events_extractor
- forums_social_extractor
- reviews_maps_extractor

---

## 12) Entity Resolution (Singapore-specific requirement)

### Dedicated Entity Resolution Service (YES)
Must handle:
- Different operating names vs ACRA registered names (e.g., “McDonald’s” vs “Hanbaobao” in ACRA)
- Multiple legal entities (multiple UENs) per brand/group

### Scoring granularity (BOTH)
- Compute scores at **UEN (legal entity)** level
- Provide **Brand roll-up view** in UI for operating/brand names

### Uncertainty handling (YES)
- Auto-resolve if confidence ≥ threshold
- Otherwise queue for analyst review
- Analyst actions persist mappings/aliases for future auto-resolve

---

## 13) Feature Store (YES)

Maintain a dedicated **Feature Store** to store:
- standardized feature values
- timestamps
- confidence
- evidence pointers
- links to contributing signals

Scoring service reads from feature store (not recomputing from scratch).

---

## 14) Risk Scoring Service (YES)

Dedicated scoring service that:
- computes Industry Risk Score (monthly)
- computes Company Signals Score (weekly)
- applies **gated** industry context adjustment
- outputs Final Company Risk Score (weekly)
- stores full score history
- stores explanation objects (ordered contributions + evidence)

---

## 15) Configuration Service (DB-backed, YES)

All adjustable settings stored in DB and editable via UI:
- category weights
- source reliability weights
- time decay settings
- gating thresholds/parameters
- alert thresholds
- emerging risk thresholds
- entity resolution thresholds

All changes must be auditable (audit log).

---

## 16) Model Training Service (YES)

### Training enabled (YES)
- Periodic retraining to improve defaults
- Incorporate:
  - historical retrenchment cases
  - feature history
  - override patterns

### Frequency
- **Monthly**

### Governance
- Training outputs are **recommendations**
- Require **human approval** before updating configs/models
- Maintain versioning and metrics

---

## 17) UI / Platform Decision

### Integrated platform (YES)
- Single platform containing backend + web UI
- Provide:
  - Industry dashboard (Analyst)
  - Company dashboard (Officer)
  - Daily morning brief (both)
  - Settings/weights UI
  - Entity resolution review UI
  - On-demand analysis UI
  - Admin ops views (connectors/queues health)

---

## 18) Singapore-specific Signal Requirements (selected examples)

- Must include URA **Retail Rental Index** (critical for F&B/retail stress)
- Sentiment sources include Singapore-relevant platforms like:
  - Reddit Singapore communities
  - HardwareZone forums
- Government sources (SingStat, MOM, URA, ACRA, eGazette) treated as high reliability by default

---

## 19) Non-goals / Removed Ideas

- **No ecosystem/supply-chain propagation scoring** (removed)
- **No geographic cluster detection** (disabled)

---

## 20) Implementation Notes for Codex Agents

### Key service boundaries (target micro-modules)
- connectors/*
- signal-processing/*
- entity-resolution/*
- feature-store/*
- risk-scoring/*
- config-service/*
- model-training/*
- web-platform/*

### Must-have cross-cutting concerns
- Audit logs for:
  - overrides
  - config changes
  - model approvals
  - entity mapping approvals
- Evidence pointers for every signal shown in UI
- Backfill/recompute support via raw data lake + reproducible pipelines

---

## 21) Implementation Baseline (Confirmed for POC)

### Data access policy
- Use **publicly available data** first.
- Prefer **API ingestion** when available.
- Fall back to **web scraping** when API is unavailable.
- If public data is insufficient, ingest **NTUC-provided internal sources** via modular connectors.
- News connectors must support **backdated ingestion** (historical pulls by date range) for backtesting and time-series score replay.

### Ground truth & lead-time labels
- Positive retrenchment label is valid when evidenced by:
  - company retrenchment **news release**, or
  - **government source** indication.
- **One trusted source is sufficient** for positive labeling.
- Prediction lead-time targets:
  - **Industry level**: 6 months
  - **Company level**: 1 month

### Entity resolution defaults
- Initial auto-resolve confidence threshold: **0.85**.
- Threshold is user-editable in settings.
- No second human approval required for high-impact mappings.

### Initial scoring defaults (all editable in settings)
- Industry stress gate threshold: **60**
- Industry adjustment weight: **0.30**
- High-risk alert threshold: **70**
- Emerging risk trigger: **weekly delta >= +10** and final score **< 70**

### Evidence, storage, and data handling defaults
- Store **full raw source content** for audit/reprocessing.
- Operational layers store metadata + evidence pointers/links.
- Apply **PII masking/redaction by default** in UI and analyst exports.
- Keep restricted access to unredacted raw objects.
- Retention baseline:
  - Raw content: 24 months online + archive up to 7 years
  - Metadata/features/audit: 7 years
  - Allow stricter per-source overrides for licensing/ToS constraints

### SLOs (POC)
- On-demand company analysis latency: **<= 1 hour**
- Daily brief readiness: **by 6:00 AM SGT**
- Uptime target: **99.5%** initial

### Role-based permissions (POC)
- Industry score overrides: **Analyst**
- Company score overrides: **Officer**
- Industry settings changes: **Analyst**
- Company settings changes: **Officer**
- Industry recommendation approvals: **Analyst**
- Company recommendation approvals: **Officer**
- Entity mapping approvals: **Officer**

### POC platform stack
- Run **locally** for POC.
- Core stack: **Next.js + local services**.
- Local data stack for day 1:
  - SQLite local database file (`.db`)
  - Local object storage (S3-compatible, e.g., MinIO)
  - Local worker/scheduler process for ingestion, scoring, and brief generation
- No requirement for self-contained executable packaging in POC.

### Phase 1 POC scope
- Industries: **F&B** and **Tech**
- Backtesting set: **~18 companies**

### Phase 1 acceptance criteria
- Company-level recall: **>= 0.80**
- Company-level precision: **>= 0.35**
- Company early warning: at least **70%** of true positives flagged >= 2 weeks before event
- Explainability completeness for high-risk alerts: **100%** with ordered contributors, evidence pointers, and score delta
- Override/config audit completeness in tested flows: **100%**
- Daily brief generated by 6:00 AM SGT on **>= 95%** of test days
- On-demand analysis <= 1 hour on **>= 95%** of runs
- Pipeline traceability raw -> processed -> feature -> score: **>= 95%**
- Entity auto-resolve precision for confidence >= 0.85: **>= 0.90**, with uncertain cases routed to manual review
- Historical backtest capability: able to rerun news ingestion and recompute scores for a selected historical date range, with visible score deltas over time
