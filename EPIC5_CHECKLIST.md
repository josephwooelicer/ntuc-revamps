# Epic 5 Checklist (Simplified): Data Processing & Persistence

## 1) Build Processing Pipeline Entry
- [x] Add a processing job that consumes completed ingestion runs.
- [x] Support both `on-demand` and `production` processing modes.
- [x] Track processing run status (`running/success/partial/failed`).

Files:
- `worker-service/index.ts`
- `worker-service/src/ingestion/engine.ts` (or new `src/processing/engine.ts`)
- `worker-service/migrations/*.sql`

## 2) Parse Raw Artifacts into Standardized Signals
- [ ] Implement parser modules per source type (news/forum/gov/registry/filings).
- [ ] Extract normalized fields:
  - `entity_name`, `uen` (if found), `event_type`, `signal_category`, `occurred_at`, `summary`
- [ ] Keep parser confidence and parser version in output.
- [x] Connector rollout: `src-news` (first connector in sequence).
- [x] Connector rollout: `src-egazette`.
- [x] Connector rollout: `src-annual-reports-listed`.
- [x] Connector rollout: `src-reddit-sentiment`.

Files:
- `worker-service/src/processing/*` (new)
- `worker-service/src/ingestion/connectors/*.ts` (only if metadata needs extension)

## 3) Entity Linking + Evidence Pointers
- [ ] Map parsed items to entity (UEN-level where possible).
- [ ] Persist evidence pointers to raw source:
  - `raw_document.id` or `raw_record.id`
  - source URL/local path
  - query/filter metadata snapshot
- [ ] Flag uncertain mappings for review queue.
- [x] Connector rollout: `src-news` (first connector in sequence).
- [x] Connector rollout: `src-egazette`.
- [x] Connector rollout: `src-annual-reports-listed`.
- [x] Connector rollout: `src-reddit-sentiment`.

Files:
- `worker-service/src/processing/*`
- `worker-service/migrations/*.sql`

## 4) Dedup at Processed Layer
- [ ] Add processed-level dedup keys (not just raw-level):
  - `source_id + canonical_url + event_date + entity_key`
- [ ] Skip duplicates across reruns and backfills.
- [ ] Keep counters for `processed_saved` and `processed_skipped`.

Files:
- `worker-service/src/processing/*`
- `worker-service/migrations/*.sql`

## 5) Persist Processed Outputs for Scoring
- [ ] Create processed tables for:
  - normalized events/signals
  - feature-ready records (time-indexed)
  - processing audit trail
- [ ] Store timestamps, confidence, source reliability weight inputs, and time-decay-ready fields.
- [ ] Ensure scoring service can read without recomputation.

Files:
- `worker-service/migrations/*.sql`
- `worker-service/src/processing/*`

## 6) API Visibility for Processed Runs
- [ ] `POST /api/v1/processing/run` (trigger processing by ingestion run or date range).
- [ ] `GET /api/v1/processing/run/:runId` (status + counters + errors).
- [ ] Optional: list recent processing runs with filters.

Files:
- `worker-service/index.ts`

## 7) PII Masking + Access Boundaries
- [ ] Apply default masking rules for user-facing processed text.
- [ ] Keep reference to unredacted raw artifacts under restricted access only.
- [ ] Record masking applied flag in processed records.

Files:
- `worker-service/src/processing/*`
- `worker-service/migrations/*.sql`

## 8) Tests
- [ ] Parser unit tests (per source family).
- [ ] Entity-linking test (matched vs uncertain route).
- [ ] Processed dedup/idempotent rerun test.
- [ ] Integration test: ingestion run -> processing run -> persisted processed rows.
- [ ] API test: create processing run and fetch status.

Files:
- `worker-service/*.test.ts`
- `worker-service/src/processing/*.test.ts` (new)

## Done When
- [ ] Raw artifacts are transformed into normalized, deduplicated processed records.
- [ ] Every processed record has evidence pointers back to raw artifacts.
- [ ] Processing reruns are idempotent and auditable.
- [ ] Processed outputs are queryable and ready for Epic 6 scoring.
