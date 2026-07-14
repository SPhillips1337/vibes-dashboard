# Architecture Decision Index

**Status: Active**  
**Last verified: 2026-07-14**

This is a discovery index, not an ADR replacement. Open the linked record before relying on a decision.

| ADR | Status | Durable boundary |
|---|---|---|
| `ADR-0001` | Accepted | Vanilla browser frontend; no framework/build step by default |
| `ADR-0002` | Accepted | Manifest-discovered modules with shared-document isolation rules |
| `ADR-0003` | Accepted | Jamendo-only royalty-free discovery |
| `ADR-0004` | Accepted | JSON metadata persistence for the single-user saved playlist |
| `ADR-0005` | Accepted | Append-only durable agent runs with verifier-owned completion |
| `ADR-0006` | Accepted | TOTP MFA plus trusted-proxy network allowlisting |
| `ADR-0007` | Accepted | Derived agent memory overlay with non-destructive Git policy |

## Update rule

When an ADR is added, superseded, or deprecated, update this index and `HERMES.md` in the same change. Decision details and consequences belong in `docs/adr/`, not here.

## Canonical sources

- `docs/adr/`
- `CONTEXT.md`
- `HERMES.md`
