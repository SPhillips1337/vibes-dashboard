# Music Discovery and Saved Library

**Status: Active**  
**Last verified: 2026-07-14**

## Hidden knowledge

- Jamendo is the only discovery source. Apple/iTunes preview URLs are prohibited; the library stores stream metadata rather than downloaded external audio.
- The canonical Vibe Station UI is `modules/music/`, not the similarly named shell audio controller in `public/js/music.js`.
- `data/music/saved_playlist.json` is mutable user data. Tests and feature work must use temporary paths or preserve local changes rather than treating the live file as a fixture.
- Removing a saved item uses the protected `DELETE /api/music/library/:id` path, persists the ordered remainder, and does not delete local MP3 files.
- Empty-playlist transitions must clear the audio source and guard play/next/previous indexing. Remove controls must be visible without hover and expose an accessible label.

## Evidence

Commit `b134c64` migrated discovery from iTunes to Jamendo. Commit `211b592` added persisted track removal and browser-state guards with focused API/UI tests.

## Canonical sources

- `docs/adr/ADR-0003-jamendo-music-api.md`
- `docs/adr/ADR-0004-json-file-playlist.md`
- `server/music-library.js`
- `modules/music/script.js`
- `test/music-library.test.js`
