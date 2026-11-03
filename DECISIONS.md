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

## 2026-11-02 minimatch 10 -> 11 by scoped override

**Status:** superseded by the 2026-11-03 entry below
**Context:** GHSA-g3hv-75wg-m249 (globparts DoS, medium) is fixed only in minimatch 11.0.1+. Every consumer in this tree (eslint, @eslint/config-array, @typescript-eslint/typescript-estree) still declares `^10.2.x`, even at their latest releases, so no plain update can reach 11.
**Decision:** `"minimatch@10": "^11.0.4"` in `overrides`, the same scoped pattern as `brace-expansion@N` and `sharp@0`. Development scope only. The nested 3.1.5 copy under eslint-config-next (eslint-plugin-import/jsx-a11y/react) is left alone: those plugins call minimatch 3's callable default export, which 11 does not provide.
**Consequences:** minimatch 11 drops `makeRe()`, `Minimatch#regexp`, the `AST` class, `matchOne()` and the `debug` option; none of the three consumers use them, and `npm run lint` on CI is the regression check. Drop the override once the consumers declare `^11` themselves.

## 2026-11-03 minimatch 3 -> 11 by unscoped override

**Status:** accepted
**Context:** GHSA-g3hv-75wg-m249 flags every minimatch below 11.0.1 in the lock, so the scoped `minimatch@10` override left Dependabot alert #82 open on the 3.1.5 copy nested under eslint-config-next (eslint-plugin-import 2.32.0, eslint-plugin-jsx-a11y 6.10.2, eslint-plugin-react 7.37.5). All three still declare `^3.1.2` at their latest releases. Every lane that loads them runs Node 26 (`.nvmrc`, CI `node-version: "26"`, `node:26-alpine`), which can `require()` the ESM-only minimatch 11.
**Decision:** `"minimatch": "^11.0.4"` in `overrides`, unscoped, replacing `minimatch@10`. Every chain resolves to 11.0.4; the nested 3.1.5 and its brace-expansion 1.1.21, balanced-match 1.0.2 and concat-map 0.0.1 leave the lock. Development scope only.
**Consequences:** `require('minimatch')` on 11 returns a namespace with `__esModule: true` and no `default`, so the plugins' `minimatch(...)` and `minimatch.default(...)` call sites throw `is not a function` when reached. No rule that reaches them is enabled by `eslint-config-next` or `eslint.config.mjs`: import/extensions, no-extraneous-dependencies, no-import-module-exports, no-internal-modules, no-namespace, no-unassigned-import; react/forbid-component-props, jsx-handler-names, jsx-pascal-case, no-danger, no-unstable-nested-components; jsx-a11y/control-has-associated-label, label-has-associated-control. Enabling one of them means scoping the override back to `minimatch@10` and living with the open alert until that plugin imports `{ minimatch }` by name. `npm run lint` on CI is the regression check. Drop the override once the consumers declare `^11` themselves.
