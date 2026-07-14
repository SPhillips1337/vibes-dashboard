# ADR-0006: TOTP MFA and Trusted-Proxy IP Access Control

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The dashboard is now reachable through a public URL and can launch agents and terminal commands on the host. A password-only session is therefore an insufficient boundary, and a network allowlist must not trust attacker-supplied forwarding headers.

## Decision

1. When `MFA_REQUIRED=true`, password verification creates only a five-minute, one-user MFA challenge. It never creates a session or CSRF token.
2. Users enroll a Google Authenticator-compatible RFC 6238 TOTP secret on first login. Enrollment is complete only after a valid code. Eight one-time recovery codes are shown once.
3. TOTP secrets are encrypted at rest with AES-256-GCM using a server-only, base64 32-byte `MFA_ENCRYPTION_KEY`. Recovery codes are stored only as SHA-256 hashes. The key must be backed up and must not be committed.
4. Administrators can see enrollment state and reset MFA. Reset revokes all sessions for that user and forces fresh enrollment.
5. `ACCESS_ALLOWED_IPS` optionally accepts exact IPv4/IPv6 addresses and CIDRs. Empty means disabled.
6. `X-Forwarded-For` is considered only when the immediate proxy peer matches `TRUSTED_PROXY_IPS`. The same allowlist applies to Express requests and Socket.io handshakes.
7. Production refuses to seed the first administrator unless `ADMIN_PASSWORD` is explicitly configured. Passwords are never logged, and user/session files are mode `0600`.

## Consequences

- Public deployments should enable MFA and terminate TLS at nginx or another trusted reverse proxy.
- Losing or rotating `MFA_ENCRYPTION_KEY` requires an administrator-controlled MFA reset for every user.
- A wrong IP/proxy allowlist can lock out operators; validate through a second connection before closing the current session.
- IP allowlisting is defense in depth, not a replacement for MFA, secure TLS, rate limiting, or host firewall policy.
