# Decisions

ADR log. Append-only.

## 2026-04-04 Next.js App Router stack

**Status:** accepted
**Context:** Greenfield web product that needs server rendering, server actions and a small container image.
**Decision:** Next.js App Router with React 19 and strict TypeScript, `output: "standalone"`, server components by default.
**Consequences:** `"use client"` only where interaction needs it. No telemetry SDKs.

## 2026-07-12 Shared Postgres on qavren-db

**Status:** accepted (PR #79)
**Context:** One Supabase project per app was costly and sprawling.
**Decision:** Kairis data lives in the `kairis` schema with its own login role on qavren-db. Runtime traffic uses the transaction pooler (:6543); migrations use session mode (:5432).
**Consequences:** App code uses no session state. Isolation is Postgres grants, not row-level security.

## 2026-10-09 Identity on qavren-auth (Keycloak)

**Status:** accepted
**Context:** Users need accounts; building auth in the app duplicates platform work.
**Decision:** Realm `kairis` (and `kairis-dev` for localhost) on qavren-auth, public PKCE client `kairis-web`, wired through `@qavren/auth-next`. Rows are keyed by the Keycloak `sub`. Owners are listed in `KAIRIS_OWNER_EMAILS` or hold the realm role `owner`.
**Consequences:** Kairis stores no passwords. Sign-out ends the Kairis session only; the Keycloak SSO session can outlive it.

## 2026-10-09 Production on the shared hub

**Status:** accepted (supersedes the Proxmox test lane, which was never built, and the per-app EC2 plan)
**Context:** One server per project drives the AWS bill; Proxmox is in storage.
**Decision:** One image in ECR, deployed over SSM to the shared Qavren-Web-Server and published through a Cloudflare tunnel at `kairis.qavrensolutions.com`. Terraform in `infra/` owns the ECR repo, OIDC role, hub tag and pull policy, tunnel and DNS.
**Consequences:** No test environment; CI and the local compose stack cover pre-production. Releases are tags named `YYYYMMDD_<name>_Release`.

## 2026-10-09 Postgres required, JSON fallback removed

**Status:** accepted
**Context:** The scaffold fell back to local JSON files when no database was configured, which hid misconfiguration.
**Decision:** `DATABASE_URL` is required and the app errors without it. Migrations are tracked in `schema_migrations`.
**Consequences:** Local development needs `npm run db:up`. Integration tests run against a real Postgres.

## 2026-10-09 Rule-based signal engine on Coinbase public data

**Status:** accepted
**Context:** Signals must be explainable to beginners and must not imply prediction.
**Decision:** Hourly candles and ticker from Coinbase public endpoints. EMA 9/21 cross within 3 candles with RSI 14 between 45 and 70. Spread, ATR and staleness gates fail closed (ticker older than 5 minutes or candle older than 3 hours). Every evaluation is stored with its rationale.
**Consequences:** No ML and no third-party data vendor. Strategy constants live in `lib/domain/strategy.ts`.

## 2026-10-09 Per-user sealed exchange keys, live submit env-gated

**Status:** accepted
**Context:** Kairis must stay non-custodial and must not be able to move user funds.
**Decision:** Each user connects their own Coinbase key. Kairis validates it with `key_permissions` and rejects transfer-capable keys. The private key is sealed with AES-256-GCM under `KAIRIS_SECRET_KEY`. Live submission is blocked unless `ENABLE_LIVE_ASSISTED_TRADING=true`.
**Consequences:** Rotating `KAIRIS_SECRET_KEY` orphans stored keys; users reconnect. The auto cycle needs `ENABLE_AUTO_MODE` as well and is owner-only.
