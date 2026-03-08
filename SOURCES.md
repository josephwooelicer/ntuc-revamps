This document lists all external data sources and the signal category they belong to. These sources feed the ingestion connectors and are mapped into standardized signals used by the scoring system.

---

## Retrieval Policy (POC)

- Prefer API access where possible.
- Use web scraping when API access is unavailable or does not support required historical replay.
- `data.gov.sg` is retrieved using URL-parameter filters via web scraping.
- `layoffs.fyi` is retrieved via web scraping (Airtable-backed content).
- News, Reddit, and HardwareZone retrieval uses Google Search scraping with `site:` and date-range filters.
- Date-filtered Google Search retrieval is required for backtesting and weight fine-tuning.
- Persist query metadata (search query, site filter, date-range, retrieval URL) with raw evidence for replay/audit.

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
eGazette | Singapore Government | Web | company liquidation notices |
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
layoffs.fyi | Layoff tracker | Web scrape (Airtable-backed) | company layoffs records |
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
ACRA BizFile | ACRA | company filings |
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
News APIs / Web News | CNA / ST / BT / NewsAPI | Google Search scrape (`site:` + date filter) / API | articles mentioning layoffs |
Reddit | r/singapore / r/asksingapore | Google Search scrape (`site:reddit.com` + date filter) / API | workforce discussions |
HardwareZone Forums | HWZ | Google Search scrape (`site:hardwarezone.com.sg` + date filter) | job discussions |
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
ACRA | Company Financial |
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
