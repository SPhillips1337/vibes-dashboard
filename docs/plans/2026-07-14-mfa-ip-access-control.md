# MFA and IP Access Control Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED-GREEN TDD and verify the deployed HTTP boundary.

**Goal:** Require a Google Authenticator-compatible TOTP factor before creating privileged dashboard sessions, and optionally reject requests outside an environment-configured IP/CIDR allowlist.

**Architecture:** Add isolated, Node-testable security modules for TOTP/encrypted secret storage and trusted-proxy-aware IP filtering. Keep password and TOTP verification as a two-stage challenge so no authenticated session or CSRF token exists after password-only login. Existing and newly created users enroll on first login when MFA is required; administrators can see MFA state and reset another user's enrollment from User Access Control.

**Tech Stack:** Node.js crypto, Express 4, Socket.io, vanilla browser JS, `qrcode` for standards-compatible otpauth QR data URLs, Node test runner.

---

### Task 1: Define TOTP and secret-storage boundary

**Files:**
- Create: `test/mfa.test.js`
- Create: `server/mfa.js`

1. Add RFC 6238 known-vector, window, malformed-code, AES-256-GCM round-trip, wrong-key, and otpauth URI tests.
2. Run `node --test test/mfa.test.js` and verify RED.
3. Implement base32, TOTP, timing-safe verification, otpauth URI generation, and authenticated encryption.
4. Run the focused test and verify GREEN.

### Task 2: Define two-stage login and enrollment behavior

**Files:**
- Create: `test/auth-routes.test.js`
- Create: `server/auth-routes.js`
- Modify: `server/auth.js`
- Modify: `server/index.js`

1. Add HTTP-boundary tests proving password-only login cannot create a session when MFA is required, invalid/replayed/expired challenges fail, enrolled users must submit TOTP, first-login enrollment returns an otpauth QR and one-time recovery codes only after verification, and completed verification creates the secure cookie.
2. Run focused tests and verify RED.
3. Add bounded one-use MFA challenges, encrypted per-user secrets, hashed recovery codes, safe user DTOs, enrollment/reset methods, and route handlers.
4. Replace inline auth/user routes with the tested router while retaining the existing `/api` authentication/CSRF guard.
5. Run focused and full tests.

### Task 3: Define network access boundary

**Files:**
- Create: `test/access-control.test.js`
- Create: `server/access-control.js`
- Modify: `server/index.js`

1. Add tests for exact IPv4/IPv6, CIDR membership, mapped IPv4 addresses, disabled allowlist, trusted proxy forwarding, and spoofed forwarding from an untrusted peer.
2. Run focused tests and verify RED.
3. Implement parsed startup configuration, Express trust-proxy integration, and fail-closed `403` middleware before static/API/Socket.io handling.
4. Run focused and full tests.

### Task 4: Update login and User Access Control UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/app.js`
- Modify: `public/css/style.css`
- Modify: `modules/settings/script.js`

1. Add source-level regression assertions for MFA challenge fields, enrollment QR/manual key/recovery display, MFA status, and reset action.
2. Verify RED.
3. Implement accessible two-stage login/enrollment UI without storing TOTP secrets or recovery codes in localStorage.
4. Show Enabled/Enrollment required status in the users table and add a CSRF-protected reset action.
5. Run syntax and full tests.

### Task 5: Configuration, documentation, and rollout

**Files:**
- Create: `.env.example`
- Create: `docs/adr/ADR-0006-mfa-and-network-access-control.md`
- Modify: `README.md`
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `CONTEXT.md`
- Modify: `HERMES.md`

1. Document `MFA_REQUIRED`, `MFA_ENCRYPTION_KEY`, `ACCESS_ALLOWED_IPS`, and `TRUSTED_PROXY_IPS`, including proxy spoofing and lockout-safe rollout guidance.
2. Document changed login responses and MFA reset endpoint.
3. Record the architecture decision and update indexes.

### Task 6: Reality gate

1. Run `npm test`.
2. Run `node --check` on changed JS files and `git diff --check`.
3. Start an isolated temporary server configuration, curl an out-of-allowlist request and an allowed login flow, and verify response status/body markers.
4. Inspect `git status` and confirm no `.env`, runtime user/session data, secrets, PID/log files, or unrelated pre-existing untracked files are included.
