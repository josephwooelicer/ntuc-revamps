# Shared Evaluation Matrix (All Sources, Same Scale)

Version: `v1.0`  
Final scale: `0-100` (higher = worse retrenchment risk signal)

## Dimensions (0-5 each)
- `distress_signal`: Strength of business deterioration signal.
- `retrenchment_proximity`: How directly the signal points to layoffs/restructuring risk.
- `impact_scope`: Expected breadth/severity (team, BU, company-wide, market exit).
- `credibility`: Source trustworthiness and specificity.
- `timeliness`: Recency and current relevance.
- `relevance`: Whether the item is actually about company risk (ads/irrelevant should be low).
- `positive_offset`: Strength of positive developments reducing risk (expansion/investment wins).

## Weights
- `distress_signal`: `0.26`
- `retrenchment_proximity`: `0.24`
- `impact_scope`: `0.15`
- `credibility`: `0.12`
- `timeliness`: `0.10`
- `relevance`: `0.13`
- `positive_offset`: `0.22` (subtracts from risk)

## Final Score Formula
- Negative component:
  - `distress*0.26 + retrenchment*0.24 + impact*0.15 + credibility*0.12 + timeliness*0.10 + relevance*0.13`
- Positive relief:
  - `positive_offset*0.22`
- Clamp to `0..5`, then convert to `0..100`.

## Label Guidance
- `negative`: Strong worsening signal.
- `neutral`: Mixed or weak signal.
- `positive`: Improvement signal likely reducing risk.
- `irrelevant`: Not materially related to retrenchment/company health signal.
