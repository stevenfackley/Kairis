# Security

Report privately through GitHub Security Advisories. Reports are acknowledged within 72 hours.

## Rules

- No static AWS keys. GitHub Actions authenticates to AWS with OIDC only.
- No telemetry SDKs. A secret-shape scan (`scripts/scan-secrets.ps1`) runs on every PR.
- Exchange secrets are stored AES-256-GCM encrypted under `KAIRIS_SECRET_KEY`. They are never logged
  or returned to the browser. Rotating the key means users reconnect their exchange keys.
- Transfer-capable exchange keys are rejected. Withdrawals are never requested.
- Live order submission is blocked unless `ENABLE_LIVE_ASSISTED_TRADING=true`.
- The auto cycle is owner-only and also needs `ENABLE_AUTO_MODE=true`.
- The host `.env` is written by the deploy with `umask 077`.
- Identity is delegated to qavren-auth (Keycloak). Kairis stores no passwords.
