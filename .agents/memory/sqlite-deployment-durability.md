---
name: SQLite deployment durability
description: Replit deployment persistence limits for the app's local SQLite archive.
---

This app's SQLite database is stored on the local filesystem. Replit documentation states that published-app files reset on restart or republication, so this is workspace persistence, not durable production storage.

**Why:** The user chose SQLite for the Processing archive; that choice should not be mistaken for safe long-term storage in a published app.

**How to apply:** Before publishing or relying on imported records in production, confirm whether to move the archive to Replit SQL or another durable storage approach.
