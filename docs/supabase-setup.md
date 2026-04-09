# Supabase Postgres Setup

## Current State

The repository contains reusable SQL migrations under `supabase/migrations/`, and the application runtime now prefers the repo's Supabase-backed Postgres settings while still supporting a generic `DATABASE_URL`.

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
- a Supabase-first managed Postgres configuration path
- a fallback `DATABASE_URL` contract for local development, Proxmox test, and GitHub deployment

## Supabase Setup

1. Open the linked Supabase project you want Kairis to use.
2. Copy the database password from Supabase.
3. Set these values:

```bash
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_REF=kcsngjxpjlwawdykzmih
SUPABASE_DB_USER=postgres.kcsngjxpjlwawdykzmih
SUPABASE_DB_PASSWORD=<your-supabase-db-password>
SUPABASE_DB_HOST=aws-1-us-east-1.pooler.supabase.com
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
```

4. Apply the repo SQL migrations to that database using either:

- the Supabase SQL editor
- `psql`
- the repo helper script `npm run db:migrate`

Example with `psql`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260404000001_core_phase4_phase5.sql
psql "$DATABASE_URL" -f supabase/migrations/20260404000002_operational_consistency.sql
```

Example with the repo helper:

```bash
SUPABASE_DB_PASSWORD=<your-supabase-db-password> npm run db:migrate
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
- `SUPABASE_DATABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_USER`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_DB_HOST`
- `SUPABASE_DB_PORT`
- `SUPABASE_DB_NAME`
