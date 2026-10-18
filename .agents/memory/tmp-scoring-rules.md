---
name: TMP scoring rules
description: Separate average-goal TMP scores, odds-based rolling TMP, and source-context limits.
---

For team form and H2H, calculate separate goal-based TMP values per team and sample: scoring TMP is `100 + 4 * average goals scored`; conceding TMP is `100 - 4 * average goals conceded`. Use each team's latest 15 completed results and the latest eight H2H meetings, and show the corresponding average directly beneath each TMP. Do not substitute a combined W/D/L performance score or above/below-average split for these two scores. Clean sheets and Over/Under 2.5 counts can remain supporting metrics.

Odds TMP is a separate team-level calculation from normalized pre-match 1X2 probabilities: expected points are `3*pHome + pDraw` for the home side and `3*pAway + pDraw` for the away side; actual points are 3/1/0; per-game score is `50 + 10*(actualPoints - expectedPoints) + 8*GD`; roll chronologically with `0.6*previous + 0.4*game`. The neutral initial roll is 50, matching the per-game baseline. Standings and other market probabilities are context, not hidden weights in either score.

Historical source data has limits: KickoffScore's season standings are the latest available for a season, not archived match-day snapshots. Historical odds may lack timestamps; show verified and unverified quote coverage and never present untimestamped quotes as confirmed pre-match prices.

**Why:** The user clarified that team TMP must separate scoring from conceding based on each sample's per-match averages; combined match-performance TMP does not answer that request. The odds-based roll remains a distinct measure.

**How to apply:** Use the two separate average-goal formulas for recent form and H2H. Keep odds TMP and source-context evidence distinct. Label standings as latest available and surface odds timestamp quality wherever historical expectations are used.
