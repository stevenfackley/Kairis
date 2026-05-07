# Kairis

> Disciplined non-custodial crypto trading workflow scaffold.

## Stack
- **Runtime:** Next.js 16 App Router + React 19 + TypeScript 5.8
- **Storage:** Postgres (`pg`)
- **Crypto:** Coinbase CDP SDK (`@coinbase/cdp-sdk`)
- **Cloud:** AWS S3 (`@aws-sdk/client-s3`)
- **Local tooling:** Supabase CLI, Wrangler

## Conventions
- **Package manager: npm** (see `package-lock.json`)
- npm `overrides`: `axios` (CVE — `^1.15.2`+, see PR #24), `postcss` (CVE — `^8.5.10`+)
- Components: server by default. `"use client"` is a scalpel, not a default.
- Lint: not configured (`"lint"` script is a no-op echo)
- Tests: not configured (`"test"` script is a no-op echo)
- Typecheck via `tsc -p tsconfig.typecheck.json --noEmit`
- Commits: Conventional Commits
- Branches: `main` protected. Squash-merge via PR.

## Deploy target
- **Test:** Proxmox (via `proxmox:preflight` and `proxmox:deploy` scripts in `package.json`)
- **Prod:** AWS EC2

## Commands
- `npm run dev` — local dev (Next dev server)
- `npm run build` — production build
- `npm run typecheck` — TS type-only check
- `npm run db:migrate` — db migrations
- `npm run proxmox:preflight` / `npm run proxmox:deploy` — test deployment

## CI/CD
- `.github/workflows/ci.yml` — runs on PRs and pushes
- `.github/workflows/deploy.yml` — Proxmox (test), EC2 (prod)
- Dockerfile: `node:22-alpine` multi-stage (deps → builder → runner)

## Do not
- Bump axios override below `^1.15.2` — multiple CVEs. The override is the *only* thing forcing transitive bumps past parent pins.
- Bump postcss override below `^8.5.10` (CVE).
- Treat `"axios": "^X.Y.Z"` overrides as set-and-forget — they silently cap the dep at `Z` until manually bumped (lesson from PR #24).
- Add static AWS keys. Use OIDC.
- Reach for CSS-in-JS. Tailwind only.
- Use `any`. Use `unknown` + narrowing.
- Add telemetry SDKs (ApplicationInsights/Sentry/Datadog/etc).
