# ADR-0004 — JSON File Persistence for Saved Playlist

**Date**: 2026-06-12  
**Status**: Accepted

## Context

Tracks discovered via Jamendo need to persist between server restarts so they appear in the user's library alongside local `public/audio/` files.

## Decision

Persist saved track metadata (not binary audio) to `data/music/saved_playlist.json` as a flat JSON array.

**Entry schema:**
```json
{
  "id": "string",
  "name": "Track Title",
  "artist": "Artist Name",
  "url": "https://cdn-stream-url"
}
```

`GET /api/audio` merges local `public/audio/` files with entries from this file.
`POST /api/music/download` appends to this file; deduplicates by `id` or `url`.

## Consequences

- ✅ No database dependency — fits the local single-user model
- ✅ Human-readable and git-diffable
- ✅ Easy to manually edit or purge stale entries
- ⚠️ Not suitable for multi-user deployments (no per-user isolation)
- ⚠️ No migration strategy — if schema changes, manually update the file
- ⚠️ Jamendo CDN signed URLs may expire; re-add tracks if playback fails

## Rules

- This file is **not gitignored** — it is user library data, acceptable to commit for personal repos
- If Apple CDN URLs appear in this file, purge them immediately
- Do not store binary audio blobs here
