This document lists all external data sources and the signal category they belong to. These sources feed the ingestion connectors and are mapped into standardized signals used by the scoring system.

---

## Retrieval Policy (POC)

- Prefer API access where possible.
- Use web scraping when API access is unavailable or does not support required historical replay.
- `data.gov.sg` is retrieved using URL-parameter filters via web scraping with `playwright`.
- `layoffs.fyi` is retrieved via web scraping for **tech layoffs only** (direct Airtable source: `https://airtable.com/app1PaujS9zxVGUZ4/shroKsHx3SdYYOzeh/tblleV7Pnb6AcPCYL?viewControls=on`).
- News, Reddit, and HardwareZone retrieval uses Google Search scraping with `playwright` through `site:`, `from:`, and `to:` filters with company name.
- At least the first 3 pages of results are scraped, and data is retrieved month-by-month.
- Date-filtered Google Search retrieval is required for backtesting and weight fine-tuning.
- Persist query metadata (search query, site filter, date-range, retrieval URL) with raw evidence for replay/audit.

### data.gov.sg connector baseline (current)

- Use one source registry record: `src-data-gov-sg`.
- Supported agencies (separated by `|`): `URA|SINGSTAT|MOM|SSG|WSG|STB|SLA|CUSTOMS|OGP|NPARKS|NHB|MAS|MOT|MSF|MLAW|MFA|MOF|MPA|STATECOURTS|IMDA|IRAS|ICA|HLB|NEA|A*STAR|CPF|CAAS|CCCS|EDB|ENTERPRISESG|GovTech|HSA|HPB`.
- Retrieve only formats: `CSV|XLSX|PDF`.
- URL parameters:
  - `formats=CSV|XLSX|PDF`
  - `coverage`: e.g., `1767196800|1772294399` for JAN 2026 to FEB 2026. `from` can be left blank to get all data up till the `to` date. If `coverage` is empty, all reports are retrieved.
  - `agencies`: e.g., `agencies=MOM`.
- Keep `query` empty and exhaust all pages.
- Automated schedule: daily at `06:00` SGT, with no `coverage` parameter.
- On-demand runs: user provides human date; system converts to SGT `23:59:59` and sends as `coverage` Unix timestamp.
- Download and store full resources, not only metadata.
- Save resources under agency-specific raw folders:
  - `data-lake/raw/URA/...`
  - `data-lake/raw/SINGSTAT/...`
  - `data-lake/raw/MOM/...`
- Deduplicate using: dataset/page URL + resource file URL.
- On duplicate hits, skip re-download.
- Retry failed file downloads 3 times with backoff.
- If a dataset has multiple resources, download all matching resources in allowed formats.
- Persist retrieval metadata for reproducibility:
  - agencies, formats, query, request URL, page number, run timestamp, optional cutoff date.

### eGazette connector baseline (current)

- Use one source registry record: `src-egazette`.
- Connector inputs: `query` (company name), `month` (1–12), `year` (YYYY).
- Searches `https://www.egazette.gov.sg/egazette-search/` using URL params `q`, `minYear`, `maxYear`, `minMonth`, `maxMonth`.
- Collects all notice page links from search results, then downloads the PDF for each notice.
- Storage path: `data-lake/raw/src-egazette/<company>/<year>/<month>/<filename>.pdf`
  - `<company>` is the slugified query string (e.g., `twelve-cupcakes`).
  - `<year>` and `<month>` are taken from the `month`/`year` options (month zero-padded to 2 digits).
- Deduplicate using notice page URL.
- Persist retrieval metadata: `query`, `company`, `year`, `month`, `filename`, notice URL.

### ACRA BizFile connector baseline (current)

- Use one source registry record: `src-acra-bizfile`.
- Connector input: `companyName` (or `query`) as the company name text.
- Search starts at `https://www.bizfile.gov.sg` and uses entity search by company name.
- Connector extracts one or more UEN values from search results using UEN format matching (`8 digits + 1 alphabet`).
- Persist retrieval metadata for reproducibility:
  - `companyName`, extracted `uen`, retrieval URL, run timestamp.

---

## 1. Macroeconomic Signals

Broad economic indicators affecting industries.

| Source | Organization | Access Mode (POC) | Example Data |
|---|---|---|---|
SingStat Table Builder | Singapore Department of Statistics | API | GDP by industry, CPI, retail sales |
MAS Statistics | Monetary Authority of Singapore | API | interest rates, financial indicators |
Singapore Tourism Board | STB | API / Web | tourist arrivals |
World Bank API | World Bank | API | global macro indicators |
FRED API | Federal Reserve | API | global economic indicators |

Example signals:

- GDP by sector
- consumer spending index
- inflation
- interest rates
- tourism demand

---

## 2. Industry Structural Signals

Industry-wide operational pressures.

| Source | Organization | Access Mode (POC) | Example Data |
|---|---|---|---|
URA Market Statistics | Urban Redevelopment Authority | Web / API | Retail Rental Index, office rental index |
SingStat | DOS | API | industry revenue indices |
ACRA | Accounting and Corporate Regulatory Authority | Web / API | business registrations/closures |
eGazette | Singapore Government | Web search at `https://www.egazette.gov.sg/egazette-search/`; connector inputs: `query` (company name → `q`), `month` (1–12 → `minMonth`/`maxMonth`), `year` (YYYY → `minYear`/`maxYear`). Example – Twelve Cupcakes, Feb 2026: `?q=twelve%20cupcakes&minYear=2026&maxYear=2026&minMonth=2&maxMonth=2` | company liquidation notices |
Singapore Customs | Government | Web / API | import/export trade data |
data.gov.sg datasets | Government Technology Agency (GovTech) | Web scrape with URL params | government open datasets used for macro/industry indicators |

Example signals:

- rental pressure
- business closure rate
- sector revenue decline
- supply chain slowdown

---

## 3. Labour Market Signals

Indicators of hiring demand and workforce changes.

| Source | Platform | Access Mode (POC) | Example Data |
|---|---|---|---|
MyCareersFuture | Government job portal | Web / API | job postings |
JobStreet | Job portal | Web | hiring demand |
LinkedIn Jobs | LinkedIn | Web | hiring trends |
layoffs.fyi | Layoff tracker | Web scrape (tech layoffs only: `https://airtable.com/app1PaujS9zxVGUZ4/shroKsHx3SdYYOzeh/tblleV7Pnb6AcPCYL?viewControls=on`) | company layoffs records |
MOM Labour Statistics | Ministry of Manpower | API / Web | unemployment, retrenchment stats |
SkillsFuture | Government | Web / API | skill demand trends |

Example signals:

- job posting decline
- hiring freeze signals
- vacancy duration
- layoffs announcements

---

## 4. Company Financial Signals

Financial health indicators for individual companies.

| Source | Organization | Example Data |
|---|---|---|
ACRA BizFile | ACRA | company filings (UEN retrieved from `https://www.bizfile.gov.sg` search by company name) |
SGX Announcements | SGX | listed company financial reports |
eGazette | Government | insolvency/liquidation |
IRAS | Inland Revenue Authority | tax-related indicators (limited access) |
Crunchbase | Private database | startup funding |
Pitchbook | Private database | venture funding |

Example signals:

- revenue decline
- funding slowdown
- liquidation filings
- auditor resignation

---

## 5. Operational Business Signals

Signals from real-world business operations.

| Source | Platform | Example Data |
|---|---|---|
Google Maps / Places API | Google | branch closures, operating hours |
Google Reviews | Google | customer complaints |
Company websites | various | product/service changes |
Delivery platforms | Grab / Deliveroo | availability changes |

Example signals:

- outlet closures
- reduced operating hours
- service disruptions
- declining customer ratings

---

## 6. Sentiment Signals

Public sentiment and discussions about companies.

| Source | Platform | Access Mode (POC) | Example Data |
|---|---|---|---|
News APIs / Web News | CNA / ST / BT / NewsAPI | Google Search scrape with `playwright` (`site:`, `from:`, `to:`, 3 pages, month-by-month) / API | articles mentioning layoffs |
Reddit | r/singapore / r/asksingapore | Google Search scrape with `playwright` (`site:reddit.com`, `from:`, `to:`, 3 pages, month-by-month) / API | workforce discussions |
HardwareZone Forums | HWZ | Google Search scrape with `playwright` (`site:hardwarezone.com.sg`, `from:`, `to:`, 3 pages, month-by-month) | job discussions |
Glassdoor | employee reviews | Web | employee sentiment |
Google Trends | Google | API / Web | search demand |

Example signals:

- layoffs discussions
- negative employee sentiment
- brand reputation decline
- search interest decline

---

## 7. Event Signals

Sudden events that may trigger layoffs.

| Source | Platform | Access Mode (POC) | Example Data |
|---|---|---|---|
News sites | CNA / ST / BT | Google Search scrape (`site:` + date filter) / API | restructuring announcements |
SGX | SGX | API / Web | corporate restructuring |
eGazette | Government | Web | insolvency notices |
Courts | Singapore Judiciary | Web | legal disputes |

Example signals:

- restructuring announcements
- regulatory fines
- lawsuits
- leadership changes

---

## Source → Category Mapping Summary

| Source | Category |
|---|---|
SingStat | Macroeconomic / Industry |
URA Rental Index | Industry Structural |
ACRA | Company Financial (UEN retrieved from `https://www.bizfile.gov.sg` search by company name) |
eGazette | Company Financial / Events |
MOM Labour Stats | Labour Market |
MyCareersFuture | Labour Market |
JobStreet | Labour Market |
LinkedIn | Labour Market |
layoffs.fyi | Labour Market / Events |
CNA / ST / BT | Sentiment / Events |
Reddit | Sentiment |
HardwareZone | Sentiment |
Google Maps | Operational |
Google Reviews | Operational |
Crunchbase | Company Financial |
