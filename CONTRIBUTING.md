# Contributing

## Flow
1. Branch off `main` (`feat/...`, `fix/...`, `docs/...`).
2. Commit with Conventional Commits.
3. Open a PR, wait for CI, squash-merge. Never push to `main`.

## Before you push

```bash
npm run lint
npm run typecheck
npm run db:up
DATABASE_URL=postgres://kairis:kairis@localhost:55433/kairis npm run test
npm run build
pwsh scripts/scan-secrets.ps1
```

The integration tests need a Postgres on localhost and are skipped without `DATABASE_URL`. They refuse
to run against a non-local host.

## Rules of thumb
- Pure logic goes in `lib/domain/*` with a unit test.
- New tables or columns: a new idempotent file in `db/migrations/`, never an edit to an applied one,
  plus the matching repo in `lib/server/repos/`.
- Every order path goes through the risk engine and writes an audit event.
- Architectural changes get a dated entry in `DECISIONS.md`.
