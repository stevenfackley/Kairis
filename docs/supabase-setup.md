# Managed Postgres Setup

## Current State

The repository contains reusable SQL migrations under `supabase/migrations/`, but the application runtime now targets a generic managed Postgres connection instead of the Supabase client path.

The app is prepared to:

- read and write onboarding, limits, paper trades, audit events, exports, and assisted orders through a server-side Postgres connection when configured
- fall back to local JSON persistence when `DATABASE_URL` is not configured
- expose current readiness in the operations dashboard and `/api/system/status`

## Files

- `supabase/migrations/20260404000001_core_phase4_phase5.sql`
- `supabase/migrations/20260404000002_operational_consistency.sql`
- `.env.example`
- `.env.proxmox-test.example`

## What This Enables

- a consistent SQL schema definition in the repo
- application portability across Neon, Supabase Postgres, or another managed Postgres host
- a single `DATABASE_URL` contract for local development, Proxmox test, and GitHub deployment

## Neon Setup

1. Create or choose the Neon project and branch you want Kairis to use.
2. Copy the Neon connection string.
3. Set these values:

```bash
DATABASE_PROVIDER=neon
DATABASE_URL=<your-neon-connection-string>
```

4. Apply the repo SQL migrations to that database using either:

- the Neon SQL editor
- `psql`
- the repo helper script `npm run db:migrate`

Example with `psql`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260404000001_core_phase4_phase5.sql
psql "$DATABASE_URL" -f supabase/migrations/20260404000002_operational_consistency.sql
```

Example with the repo helper:

```bash
DATABASE_URL=<your-neon-connection-string> npm run db:migrate
```

## Required Tables

The migrations define:

- `onboarding_states`
- `trading_limits`
- `paper_trades`
- `audit_events`
- `export_artifacts`
- `assisted_orders`

The second migration also:

- expands audit event categories for assisted-order and operations events
- adds `user_id` to `assisted_orders`
- creates a user-scoped assisted-order index

## Runtime Variables

Use these environment variables for the active managed Postgres path:

- `DATABASE_PROVIDER`
- `DATABASE_URL`
