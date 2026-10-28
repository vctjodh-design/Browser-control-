---
name: 365Scores live tracker
description: The animated live pitch widget and limits of public match-data endpoints.
---

365Scores embeds its live pitch as a Sportradar Live Match Tracker iframe. The public match-state and play-by-play endpoints expose discrete events and commentary, not continuous ball or player coordinates. In headless browser inspection, the widget iframe and loader were present but its pitch did not render, even while the match page reported a live minute. The validated capture proxy blocked the Sportradar widgetloader with `net::ERR_BLOCKED_BY_ORB`; this is a capture limitation, not evidence that the live mobile page lacks the animation.

On an active match page, the live commentary endpoint can be `sportradarpbp.365scores.com/api/data/GetPlayByPlay`. Its response includes `Messages`, `UpdateURL`, `TTL`, and `LastMessageId`; `UpdateURL` points back to the same endpoint for incremental updates using `lastMessage`. Message fields describe incidents and commentary, not coordinates.

**Why:** Live screenshots showed a moving pitch, while endpoint inspection found the widget integration but no usable position feed.

**How to apply:** Use the play-by-play update URL for incident refreshes. For computer vision, use authorized accessible frames or a licensed Sportradar feed. Treat widget-internal requests as undocumented; do not claim the public event API provides tracking coordinates.
