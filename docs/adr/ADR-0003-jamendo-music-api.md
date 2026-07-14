# ADR-0003 — Jamendo API for Music Discovery

**Date**: 2026-06-12  
**Status**: Accepted

## Context

The dashboard had a music discovery feature that originally used the **iTunes Search API** to find and preview tracks. This was identified as legally problematic for public shipping — iTunes preview URLs serve copyright-encumbered commercial tracks.

**Alternatives evaluated:**

| Option | Result |
|---|---|
| iTunes Search API | ❌ Copyright-encumbered; not suitable for redistribution or public deployment |
| Pixabay API | ❌ No audio/music API endpoint — images and video only (confirmed via official docs at https://pixabay.com/api/docs/) |
| Jamendo API v3 | ✅ Royalty-free, Creative Commons licensed music; free public API with `client_id` |
| Freesound API | Considered but requires per-user API key; Jamendo sufficient for music discovery |

## Decision

Use the **Jamendo API v3** (`https://api.jamendo.com/v3.0/tracks/`) for music discovery search.

- Development `client_id`: `709fa152` (Jamendo public dev key)
- For production: register a dedicated app at https://developer.jamendo.com/
- Stream URLs from Jamendo CDN (`prod-1.storage.jamendo.com`) are used directly; no binary files are downloaded

**Response mapping:**
```
Jamendo `id`          → hit.id
Jamendo `name`        → hit.tags  (track title)
Jamendo `artist_name` → hit.user  (artist)
Jamendo `duration`    → hit.duration
Jamendo `audio`       → hit.audio (CDN stream URL)
```

## Consequences

- ✅ All discoverable music is royalty-free and CC-licensed
- ✅ No copyright liability for streamed previews
- ✅ Real artist/track metadata and album art available via Jamendo
- ⚠️ Jamendo CDN stream URLs include signed tokens that may expire — do not cache them long-term
- ⚠️ The dev `client_id` is rate-limited; register a production key before public launch
- ⚠️ Jamendo does not provide 30-second previews — full tracks stream (or until user stops)

## What Changed

- `server/index.js`: `GET /api/music/search` now queries Jamendo instead of iTunes
- `modules/music/view.html`: Discovery tab label updated to "Discovery (Jamendo)"
- `data/music/saved_playlist.json`: Any existing Apple CDN entries purged
