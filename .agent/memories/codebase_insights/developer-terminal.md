# Developer Terminal Runtime

**Status: Active**  
**Last verified: 2026-07-14**

## Hidden knowledge

- The Developer Terminal executes commands on the dashboard host through the authenticated Socket.io connection. It is not a browser-only emulator.
- The server process directory is the authoritative initial working directory. The browser requests it with `terminal-cwd-request`; checkout-specific paths must never be hardcoded in module JavaScript.
- A client may retain a directory that was renamed or removed. Before `spawn`, `resolveWorkingDirectory` checks the requested path and falls back to the live server directory, then the host home and root directories. A recovery is sent back as a prompt update.
- Node reports `ENOENT` for a valid shell when the `spawn` working directory does not exist. Confirm both the shell executable and `cwd` before diagnosing a missing binary.
- A failed spawn can emit both `error` and `close`. `bindTerminalProcess` settles once so the UI receives one error and one exit result rather than duplicate exit codes.

## Canonical sources

- `server/terminal-exec.js`
- `server/index.js`
- `modules/terminal/script.js`
- `test/terminal-exec.test.js`
