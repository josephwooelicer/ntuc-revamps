This document lists all external data sources and the signal category they belong to. These sources feed the ingestion connectors and are mapped into standardized signals used by the scoring system.

---

## 1. Macroeconomic Signals

Broad economic indicators affecting industries.

| Source | Organization | Example Data |
|---|---|---|
SingStat Table Builder | Singapore Department of Statistics | GDP by industry, CPI, retail sales |
MAS Statistics | Monetary Authority of Singapore | interest rates, financial indicators |
Singapore Tourism Board | STB | tourist arrivals |
World Bank API | World Bank | global macro indicators |
FRED API | Federal Reserve | global economic indicators |

Example signals:

- GDP by sector
- consumer spending index
- inflation
- interest rates
- tourism demand

---

## 2. Industry Structural Signals

Industry-wide operational pressures.

| Source | Organization | Example Data |
|---|---|---|
URA Market Statistics | Urban Redevelopment Authority | Retail Rental Index, office rental index |
SingStat | DOS | industry revenue indices |
ACRA | Accounting and Corporate Regulatory Authority | business registrations/closures |
eGazette | Singapore Government | company liquidation notices |
Singapore Customs | Government | import/export trade data |

Example signals:

- rental pressure
- business closure rate
- sector revenue decline
- supply chain slowdown

---

## 3. Labour Market Signals

Indicators of hiring demand and workforce changes.

| Source | Platform | Example Data |
|---|---|---|
MyCareersFuture | Government job portal | job postings |
JobStreet | Job portal | hiring demand |
LinkedIn Jobs | LinkedIn | hiring trends |
layoffs.fyi | Layoff tracker | company layoffs records |
MOM Labour Statistics | Ministry of Manpower | unemployment, retrenchment stats |
SkillsFuture | Government | skill demand trends |

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

| Source | Platform | Example Data |
|---|---|---|
News APIs | CNA / ST / BT / NewsAPI | articles mentioning layoffs |
Reddit | r/singapore / r/asksingapore | workforce discussions |
HardwareZone Forums | HWZ | job discussions |
Glassdoor | employee reviews | employee sentiment |
Google Trends | Google | search demand |

Example signals:

- layoffs discussions
- negative employee sentiment
- brand reputation decline
- search interest decline

---

## 7. Event Signals

Sudden events that may trigger layoffs.

| Source | Platform | Example Data |
|---|---|---|
News sites | CNA / ST / BT | restructuring announcements |
SGX | SGX | corporate restructuring |
eGazette | Government | insolvency notices |
Courts | Singapore Judiciary | legal disputes |

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
