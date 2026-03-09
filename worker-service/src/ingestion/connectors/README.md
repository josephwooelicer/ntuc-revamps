# Connectors Reference

This document describes all connectors under `worker-service/src/ingestion/connectors`.

## At a glance

| Connector class | `id` | File | Primary source | Output |
|---|---|---|---|---|
| `DataGovSgConnector` | `src-data-gov-sg` | `data-gov-sg.ts` | `data.gov.sg` dataset pages/downloads | `documents[]` (raw files) |
| `NewsGoogleSearchConnector` | `src-news` | `news-google-search.ts` | Google Search for SG news sites | `documents[]` (CSV + screenshot) |
| `LayoffsFyiConnector` | `src-layoffs-fyi` | `layoffs-fyi.ts` | layoffs.fyi Airtable tracker | `documents[]` (consolidated CSV) |
| `EgazetteConnector` | `src-egazette` | `egazette.ts` | Singapore e-Gazette search | `documents[]` (PDF buffers) |
| `AcraBulkSyncConnector` | `src-acra-bulk-sync` | `acra-bulk-sync.ts` | data.gov.sg ACRA bulk datasets | DB side-effect (`acra_entities` upsert), no docs |
| `AcraLocalSearchConnector` | `src-acra-data-gov-sg` | `acra-bulk-sync.ts` | Local SQLite `acra_entities` | `records[]` (UEN/entity_name) |
| `ListedCompanyAnnualReportsConnector` | `src-annual-reports-listed` | `listed-company-annual-reports.ts` | Google Search for annual report PDFs | `documents[]` (CSV) |
| `RedditSentimentConnector` | `src-reddit-sentiment` | `reddit-sentiment.ts` | Google Search + Reddit JSON | `documents[]` (post comments CSVs) |

## Registration status in worker-service

Registered in `worker-service/index.ts`:
- `DataGovSgConnector`
- `NewsGoogleSearchConnector`
- `LayoffsFyiConnector`
- `EgazetteConnector`
- `AcraBulkSyncConnector`
- `AcraLocalSearchConnector`
- `ListedCompanyAnnualReportsConnector`

Present in source but currently not registered in `index.ts`:
- `RedditSentimentConnector`

## Common connector contract

All connectors implement:

- `id: string`
- `pull(range?, cursor?, options?, onDocument?, onRecord?) => Promise<IngestionResult>`

`IngestionResult` supports:
- `documents: RawDocument[]`
- `records?: any[]`
- `cursor?: string`

`RawDocument` core fields:
- `id`, `sourceId`, `fetchedAt`, `title`, `url`, `content`
- optional `externalId`, `publishedAt`, `metadata`

## Connector details

### 1) `DataGovSgConnector` (`src-data-gov-sg`)

File: `data-gov-sg.ts`

Purpose:
- Scrapes `https://data.gov.sg/datasets` for datasets by agency.
- Opens each dataset panel and captures downloadable files.

Key options:
- `agency` (default: `MOM`)

Behavior:
- Builds URL with `agencies=<agency>` and formats `CSV|XLSX|PDF`.
- Repeatedly clicks "Load more" to expand listing.
- Extracts dataset links from `resultId=d_*` URLs.
- For each dataset, attempts download button clicks and captures downloaded file.
- Keeps only `CSV`, `XLSX`, `PDF` extensions.

Output:
- One `RawDocument` per downloaded file (binary `content`).
- Metadata includes: `agency`, `datasetId`, `date`, `filename`, `customDir` (`<agency>/<YYYY-MM-DD>`).

Notes:
- Uses Playwright in headless mode.
- Best-effort per-file download (individual failures are skipped).

### 2) `NewsGoogleSearchConnector` (`src-news`)

File: `news-google-search.ts`

Purpose:
- Runs Google searches for company news across configured SG outlets.

Default outlets:
- `straitstimes.com`
- `channelnewsasia.com`
- `todayonline.com`
- `businesstimes.com.sg`

Key options:
- `company_name` (required for meaningful results)

Range usage:
- If `range` is present, query includes `after:<startSGT>` and `before:<endSGT>`.

Behavior:
- Uses anti-detection search flow:
- randomized user agent/viewport
- paced delays and light mouse/scroll interaction
- challenge-page detection (`/sorry/`, consent/captcha/unusual-traffic text)
- retries with cooldown and Google host rotation (`google.com`, `google.com.sg`)
- Scrapes result cards (`div.g`, `div.tF2Cxc`).
- Falls back to general company query if site-specific queries return nothing.
- De-duplicates by normalized URL.

Output:
- CSV document (`data.csv`) with `Title,URL,Snippet,Outlet` when results exist.
- Screenshot document (`screenshot.png`) when `toScreenshot=true` (currently true).
- Metadata includes `company_name`, `customDir`, `filename`.

### 3) `LayoffsFyiConnector` (`src-layoffs-fyi`)

File: `layoffs-fyi.ts`

Purpose:
- Scrapes layoffs.fyi Airtable layoff tracker and returns country-filtered rows.

Key options:
- `country` (default: `Singapore`)

Behavior:
- Opens Airtable shared view URL.
- Attempts to apply Airtable UI filter by country.
- Independently post-filters rows in code (safety check).
- Handles virtualized Airtable grid by scrolling and joining left/right panes via `data-rowid`.
- Extracts company, location, layoffs count, date, %, industry, source, stage, funds raised.
- Deduplicates by `company|location|date`.

Output:
- Single consolidated CSV `RawDocument` named `data.csv` when rows exist.
- Metadata includes `country` and `recordCount`.

Notes:
- Launches Playwright with `headless: false` currently.

### 4) `EgazetteConnector` (`src-egazette`)

File: `egazette.ts`

Purpose:
- Searches Singapore e-Gazette and downloads matching PDF notices.

Key options:
- `query` (company/keyword)
- `month` (1-12)
- `year` (YYYY)

Range usage:
- If options are missing, defaults month/year from `range.start` (or current SGT date).

Behavior:
- Builds search URL with `q`, `minYear/maxYear`, `minMonth/maxMonth`.
- Uses fallback host retry (`www.egazette.gov.sg`, `egazette.gov.sg`).
- Waits for Algolia hit containers and collects direct `assets.egazette.gov.sg/*.pdf` links.
- Downloads PDFs through Playwright request API.

Output:
- One PDF `RawDocument` per unique link (binary `content`).
- Metadata includes `customSubDir`, `company`, `query`, `year`, `month`, `filename`.

### 5) `AcraBulkSyncConnector` (`src-acra-bulk-sync`)

File: `acra-bulk-sync.ts`

Purpose:
- Bulk syncs ACRA entity records from 27 letter-segmented datasets into local SQLite.

Key options:
- `limitDatasets` (optional; for test-limited runs)

Behavior:
- Visits each dataset view page on data.gov.sg.
- Clicks `Download` and reads downloaded CSV.
- Parses rows and upserts into `acra_entities` table:
- `uen`, `entity_name`, `entity_type`, `status`, `registration_date`
- Uses batched transactions (`1000` rows/batch).

Output:
- Returns `documents: []`.
- Primary effect is DB mutation (upserted entities).

### 6) `AcraLocalSearchConnector` (`src-acra-data-gov-sg`)

File: `acra-bulk-sync.ts`

Purpose:
- Queries local `acra_entities` table for quick entity lookup.

Key options:
- `companyName` or `query`

Behavior:
- Performs SQL `LIKE` search against `entity_name` and `uen`.
- Limits to 100 matches.

Output:
- Returns `records[]` with minimal shape:
- `uen`
- `entity_name`
- No `documents` produced.

### 7) `ListedCompanyAnnualReportsConnector` (`src-annual-reports-listed`)

File: `listed-company-annual-reports.ts`

Purpose:
- Finds annual-report PDFs for listed companies using Google search.

Key options:
- `company_name` (single) and/or `company_names` (array)

Range usage:
- Adds `after:` / `before:` filters when `range` is provided.

Behavior:
- Builds query targeting report hosts:
- `site:links.sgx.com OR site:sgx.com OR site:annualreports.com`
- Scans first 3 Google results pages (`start=0,10,20`).
- Stops on Google 429 or empty page.
- Extracts title/url/snippet/source/query and de-duplicates by normalized URL.

Output:
- One CSV `RawDocument` per company (`annual_reports.csv`).
- Metadata includes `company_name`, `query`, `result_count`, `customDir`.

### 8) `RedditSentimentConnector` (`src-reddit-sentiment`)

File: `reddit-sentiment.ts`

Purpose:
- Finds Reddit threads via Google and retrieves thread comments from Reddit JSON endpoints.

Key options:
- `company_name`

Range usage:
- Adds `after:` / `before:` filters when `range` is provided.

Behavior:
- Google query is constrained to `site:reddit.com/r/Singapore`.
- Extracts thread URLs from search result anchors.
- Converts each thread URL to `.json` endpoint.
- Parses comments recursively (includes nested replies).
- Detects blocked responses (`"You've been blocked"`, `"Whoa there"`) and skips.

Output:
- One CSV `RawDocument` per Reddit post with columns:
- `Author,Body,Score,CreatedUTC`
- Metadata includes `company_name`, `post_id`, `post_title`, `filename`, `customDir`.

## Operational caveats

- Several connectors rely on Playwright selectors tied to third-party DOMs (Google/Airtable/eGazette/data.gov.sg). Selector drift can break ingestion.
- Google-based connectors (`src-news`, `src-annual-reports-listed`, `src-reddit-sentiment`) are rate-limit/challenge-prone and should be run with pacing.
- `LayoffsFyiConnector` currently uses headed mode (`headless: false`), which affects CI/remote execution.
- `AcraBulkSyncConnector` and `AcraLocalSearchConnector` assume SQLite DB path `data/ntuc-ews.db` relative to repo root.

## Suggested maintenance checklist

- Revalidate selectors monthly for Google/Airtable/eGazette/data.gov.sg.
- Keep user-agent profiles updated for Playwright-based search connectors.
- Add integration smoke tests per connector using a small deterministic fixture window.
- Monitor connector runtime and empty-result rates for early breakage detection.

## How To Create A New Connector

Use this checklist when adding a connector under `worker-service/src/ingestion/connectors`.

### 1) Create the connector file

Create a new file:
- `worker-service/src/ingestion/connectors/<new-connector>.ts`

Implement the shared interface from `worker-service/src/ingestion/types.ts`:

```ts
import { Connector, IngestionRange, IngestionResult, RawDocument } from '../types';

export class NewConnector implements Connector {
  id = 'src-new-connector';

  async pull(
    range?: IngestionRange,
    cursor?: string,
    options?: Record<string, any>,
    onDocument?: (doc: RawDocument) => Promise<void>,
    onRecord?: (record: any) => Promise<void>
  ): Promise<IngestionResult> {
    const documents: RawDocument[] = [];

    // Build documents and optionally call onDocument for each:
    // if (onDocument) await onDocument(doc);
    // documents.push(doc);

    return { documents, cursor: undefined };
  }
}
```

### 2) Choose a stable `id`

- Use `src-<name>` format (example: `src-ura-rental-index`).
- Keep it immutable after release because this is used across storage and ingestion flows.

### 3) Define options and range behavior

- Accept runtime inputs via `options` (for example `company_name`, `agency`, `country`).
- If historical/backfill is required, use `range.start` and `range.end` explicitly in query construction.
- Log the effective query/filter params for traceability.

### 4) Produce standardized outputs

- Return `documents[]` for raw or transformed payloads (CSV/PDF/JSON/binary).
- Return `records[]` only for lookup-style connectors (for example local search).
- For each `RawDocument`, set:
- `id` (deterministic hash)
- `sourceId` (same as connector `id`)
- `fetchedAt` (ISO timestamp)
- `title`, `url`, `content`
- `metadata` including source query parameters and storage hints like `filename`/`customDir`

### 5) Register the connector

In `worker-service/index.ts`:

1. Import the class
2. Register it on `ingestionEngine`

Example:

```ts
import { NewConnector } from './src/ingestion/connectors/new-connector';
ingestionEngine.registerConnector(new NewConnector());
```

### 6) Add source metadata (if needed)

If this source must appear in `/api/v1/sources`, add/create the corresponding source row through existing source APIs or seed/migration flow.

### 7) Validate locally

From `worker-service`:

```bash
npm run typecheck
```

Run an ingestion path that exercises the connector (debug/on-demand path) and verify:
- files are written to expected data-lake location
- metadata includes query/filter/date-range fields
- connector handles empty-result and transient failure paths safely

### 8) Update documentation

- Add the new connector to the \"At a glance\" table in this file.
- Add a connector detail section (purpose, options, behavior, output, caveats).
