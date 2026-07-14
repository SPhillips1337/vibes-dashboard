# Authentication and Network Boundary

**Status: Active**  
**Last verified: 2026-07-14**

## Hidden knowledge

- With `MFA_REQUIRED=true`, password success creates only a short-lived MFA challenge. No authenticated session or CSRF token exists until TOTP or a recovery code succeeds.
- Every protected HTTP, module, proxy, and Socket.io boundary uses the shared MFA-aware session policy. Legacy sessions without the verification marker fail closed.
- TOTP secrets are AES-256-GCM encrypted with a server-only key; recovery codes are stored as hashes and consumed once. MFA reset revokes the user's sessions.
- Forwarded client addresses are accepted only when the immediate peer is in `TRUSTED_PROXY_IPS`. The same IP/CIDR policy protects HTTP and Socket.io.
- Production startup must not seed a default administrator without an explicit password. Shell-sourced `.env` values containing spaces must be quoted.

## Evidence

Commits `6d6ee3d`, `e38f446`, and `1d82b8d` introduced the MFA/network boundary, enrollment flow, and shared session-verification enforcement. The access-control, MFA, session-policy, and rate-limit suites exercise these seams.

## Canonical sources

- `docs/adr/ADR-0006-mfa-and-network-access-control.md`
- `server/session-policy.js`
- `server/access-control.js`
- `server/mfa.js`
- `test/session-policy.test.js`
