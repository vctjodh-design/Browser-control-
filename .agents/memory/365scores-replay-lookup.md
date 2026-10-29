---
name: 365Scores replay lookup
description: Correct 365Scores endpoints and date fields for locating historical match reports.
---

For date-based historical replay lookup, use `web/games/results/` with `date=YYYY-MM-DD` and a 365Scores competition ID. The generic `web/games/` endpoint can ignore date filters and return current or upcoming fixtures. Historical result records may expose kickoff time as `date` instead of `startTime`.

**Why:** A historical Serie A fixture appeared in the direct match and results APIs while the generic games endpoint returned the following day's fixtures.

**How to apply:** Prefer the results endpoint when looking up completed matches by date. Before attaching replay data, verify the source record's date, home and away teams, and score against the fixture.

Keep 365Scores requests serialized and paced, reuse cached results, honor `Retry-After`, and pause after rate limits, access denials, server errors, or unexpected challenge content. Do not rotate proxies or identities to bypass source restrictions.

**Why:** The user wants 365Scores collection to reduce repeat traffic and avoid rate limits, blocks, or IP bans.

**How to apply:** Route all 365Scores lookup paths through the shared request policy. Its cooldown is process-local, so use shared coordination if the API later runs multiple instances.

For FAIR AI Forensics, use a date/team/score-verified 365Scores replay to supplement incomplete KickoffScore match details. Preserve KickoffScore values when present, and report fields that remain unavailable after fallback.

**Why:** The user asked for Forensics to try 365Scores when KickoffScore lacks full match details.

**How to apply:** Keep 365Scores fallback on the existing paced replay path. Merge only missing or more complete evidence; never treat unavailable source data as observed.
