---
name: 365Scores live tracker
description: The animated live pitch widget and limits of public match-data endpoints.
---

365Scores embeds its live pitch as a Sportradar Live Match Tracker iframe. The public match-state and play-by-play endpoints expose discrete events and commentary, not continuous ball or player coordinates. In headless browser inspection, the widget iframe and loader were present but its pitch did not render, even while the match page reported a live minute.

**Why:** Live screenshots showed a moving pitch, while endpoint inspection found the widget integration but no usable position feed.

**How to apply:** For computer vision, use authorized accessible frames or a licensed Sportradar feed. Treat the widget’s internal data requests as undocumented; do not claim the public 365Scores event API provides tracking coordinates.
