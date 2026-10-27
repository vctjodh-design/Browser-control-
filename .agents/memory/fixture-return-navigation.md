---
name: Fixture return navigation
description: The fixture list's filter and return-position behavior when opening match details.
---

Opening a match from the fixture list must keep the user's active filters separate from the clicked fixture's competition. Returning should preserve the original list and bring the clicked competition back into view without filtering away the other competitions.

**Why:** Automatically applying the clicked match's competition as a filter hides unrelated fixtures and makes browsing across leagues difficult.

**How to apply:** When changing fixture-to-match navigation, carry the clicked competition only as a scroll/return target. Preserve actual filters and restore the prior list position on browser Back and in-page return links.
