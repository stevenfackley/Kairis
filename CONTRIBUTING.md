# Contributing

## Flow
1. Branch off `main`.
2. Conventional Commits.
3. PR → CI green → squash-merge.

## Pre-push (`/ship`)

```bash
npm run lint
npm run typecheck
npm run test
npm run build
pwsh scripts/scan-secrets.ps1
```

## Major changes
Add a `DECISIONS.md` ADR entry for architectural changes.
