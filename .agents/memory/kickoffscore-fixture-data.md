---
name: KickoffScore fixture details
description: Non-obvious response shape and historical data coverage in KickoffScore's fixture API.
---

KickoffScore's fixture-detail response is an aggregate record: it can contain events, lineups, player statistics, and team statistics split into full-match, first-half, and second-half arrays. Do not assume API-Football-style per-section routes exist; probe the provider's actual response shape first. Historical odds can be absent for completed matches, and shot coordinates or xG timelines may not be included even when aggregate xG statistics are present.

**Why:** The aggregate fixture response contained the requested match details while guessed section-specific paths returned 404; the odds endpoint returned no archived markets for finished fixtures.

**How to apply:** When extending KickoffScore match details, parse the fixture aggregate first, preserve period-specific statistics, and represent absent archived sections explicitly rather than filling them with derived or invented values.
