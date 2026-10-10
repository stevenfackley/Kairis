# Kairis

> Disciplined, non-custodial crypto trading: signals with rationale, a risk engine, paper and assisted Coinbase trading.

## Stack
- Next.js 16 App Router, React 19, TypeScript 5.8 strict, standalone output
- Identity: qavren-auth Keycloak realm `kairis` (`kairis-dev` locally) via `@qavren/auth-next` + `next-auth` v5
- Database: qavren-db shared Postgres, schema/role `kairis`, `pg`; prod runtime goes through the :6543 transaction pooler
- Exchange: Coinbase Advanced Trade REST; `@coinbase/cdp-sdk` for auth (JWT signing) only
- Exports: Cloudflare R2 via `@aws-sdk/client-s3`, local file fallback
- Tests/lint: vitest 5, eslint 10 (`eslint-config-next`)

## Layout
- `lib/domain/*`: pure, unit-tested logic (indicators, signals, risk, paper, crypto, csv, owner)
- `lib/server/repos/*`: one module per table; `lib/server/db.ts` holds the pool
- `lib/server/services/*`: combine repos, market data and the exchange; take a `userId`
- `app/app/<area>/{page.tsx,actions.ts}`: server pages and server actions; `proxy.ts` gates `/app/*`
- `db/migrations/*.sql`: idempotent, applied in name order by `scripts/db-migrate.mjs`
- `infra/`: Terraform for the hub deploy; `docs/` for design, deployment, database, identity

## Commands
- `npm run dev` / `build` / `start`
- `npm run lint`, `npm run typecheck`, `npm run test`
- `npm run db:up` / `db:down` (local Postgres 17 on 55433), `npm run db:migrate`
- Integration tests: `DATABASE_URL=postgres://kairis:kairis@localhost:55433/kairis npm run test`
- `pwsh scripts/scan-secrets.ps1`

## Conventions
- **npm** only (`package-lock.json`). Overrides in `package.json`: `axios`, `postcss`, `ws`, `brace-expansion`, `sharp@0`, `undici`.
- Server components by default; `"use client"` only where interaction needs it.
- Styling: global CSS tokens in `app/globals.css`. No CSS-in-JS, no Tailwind.
- `unknown` + narrowing, never `any`.
- Commits: Conventional Commits. `main` is protected; branch, PR, squash-merge.
- Architectural change gets a dated ADR in `DECISIONS.md`.

## Deploy
Shared hub (Qavren-Web-Server) behind a Cloudflare tunnel. `deploy-prod.yml` runs on tags named
`YYYYMMDD_<name>_Release`: build to ECR, migrate, deploy over SSM. See `docs/deployment.md`.

## Do not
- Bump the `axios` override below `^1.15.2` (CVEs). It is the only thing forcing transitive bumps past parent pins.
- Bump the `postcss` override below `^8.5.10` (CVE).
- Treat a caret override as set-and-forget: it silently caps the dependency (lesson from PR #24).
- Add static AWS keys. Use OIDC.
- Add telemetry SDKs (Sentry, Datadog, Application Insights, etc.).
- Commit `.env*` files (except `.env.example`).
- Store exchange secrets unsealed, log them, or return them to the browser.
- Accept transfer-capable exchange keys.
- Bypass `ENABLE_LIVE_ASSISTED_TRADING`.
- Rely on Postgres session state (SET, named prepared statements, advisory locks) in app code.
- Loosen Dependabot: keep it monthly, grouped, limit 3.
