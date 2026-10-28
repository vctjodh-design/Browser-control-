---
name: 365Scores replay lookup
description: Correct 365Scores endpoints and date fields for locating historical match reports.
---

For date-based historical replay lookup, use `web/games/results/` with `date=YYYY-MM-DD` and a 365Scores competition ID. The generic `web/games/` endpoint can ignore date filters and return current or upcoming fixtures. Historical result records may expose kickoff time as `date` instead of `startTime`.

**Why:** A historical Serie A fixture appeared in the direct match and results APIs while the generic games endpoint returned the following day's fixtures.

**How to apply:** Prefer the results endpoint when looking up completed matches by date. Before attaching replay data, verify the source record's date, home and away teams, and score against the fixture.
