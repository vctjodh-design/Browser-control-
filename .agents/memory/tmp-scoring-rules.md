---
name: TMP scoring rules
description: User-defined proxy and rolling odds formulas plus source-context limits.
---

For this app, the user's results-based proxy is `100 + 18W + 8D - 6L + 4(GF - GA)`. Apply it separately to each team's latest 15 completed matches and the latest eight H2H meetings. Also report average goals for/against, clean sheets, and Over/Under 2.5 counts. The above/below split compares each team's goals scored with that sample's own average; equal values remain a separate group.

Odds TMP is a separate team-level calculation from normalized pre-match 1X2 probabilities: expected points are `3*pHome + pDraw` for the home side and `3*pAway + pDraw` for the away side; actual points are 3/1/0; per-game score is `50 + 10*(actualPoints - expectedPoints) + 8*GD`; roll chronologically with `0.6*previous + 0.4*game`. The neutral initial roll is 50, matching the per-game baseline. Standings and other market probabilities are context, not hidden weights in either score.

Historical source data has limits: KickoffScore's season standings are the latest available for a season, not archived match-day snapshots. Historical odds may lack timestamps; show verified and unverified quote coverage and never present untimestamped quotes as confirmed pre-match prices.

**Why:** The user supplied these proxy formulas and wants opponent/market context without silently changing the scoring weights. Source provenance matters because historical time-specific tables and odds are not consistently available.

**How to apply:** Preserve the formula and separate contextual evidence from scores in future match-analysis work. Label standings as latest available and surface odds timestamp quality wherever historical expectations are used.
