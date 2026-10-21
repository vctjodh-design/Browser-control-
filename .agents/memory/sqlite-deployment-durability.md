---
name: SQLite archive constraints
description: Production durability limits and large-payload query behavior for the local SQLite archive.
---

This app's SQLite database is stored on the local filesystem. Replit documentation states that published-app files reset on restart or republication, so this is workspace persistence, not durable production storage.

**Why:** The user chose SQLite for the Processing archive; that choice should not be mistaken for safe long-term storage in a published app.

**How to apply:** Before publishing or relying on imported records in production, confirm whether to move the archive to Replit SQL or another durable storage approach.

The archived match payloads contain very large JSON documents. Bulk-materializing those documents in Node can exceed the process heap even when the row count looks modest. Analytics and training reads should use compact projections of only the fields they need, preferably indexed and maintained as archive rows are saved.

**Why:** A model-training summary request exhausted the Node heap when it loaded complete per-match payloads instead of the small subset of odds and result fields needed for analysis.

**How to apply:** For reporting or model features over this archive, avoid loading raw details, lineups, and statistics into memory. Use a compact, queryable projection and keep it synchronized when archive rows are inserted, updated, or cleared.
