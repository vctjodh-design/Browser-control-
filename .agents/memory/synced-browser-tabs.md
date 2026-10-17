---
name: Synchronized browser tabs
description: User-chosen cap and interaction model for mirrored browsing.
---

Synchronized browsing should open at most 25 copies of a URL per browser session. Mirrored pointer and page actions use the same viewport coordinates across tabs; page layouts may differ.

**Why:** The user chose 25 tabs after learning that 1,000 concurrent copies could overwhelm the browser service and create a large burst of requests.

**How to apply:** Preserve the 25-tab UI and server-side cap. Ask before raising it, and keep public-URL validation and the secure egress proxy on every tab.
