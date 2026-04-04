# Supabase Setup

## Current State

The repository now contains a local `supabase/` project skeleton and SQL migration set, but the cloud project is not linked yet.

The application is already prepared to:

- read and write onboarding, limits, paper trades, audit events, exports, and assisted orders through the Supabase admin client when configured
- fall back to local JSON persistence when Supabase is not configured
- expose current readiness in the operations dashboard and `/api/system/status`

## Files

- `supabase/config.toml`
- `supabase/migrations/20260404_000001_core_phase4_phase5.sql`
- `supabase/migrations/20260404_000002_operational_consistency.sql`

## What This Enables

- a consistent local schema definition in repo
- later use of `supabase link`
- later use of `supabase db push`
- alignment between the app data model and the managed backend

## Recommended Next Steps

1. Install the Supabase CLI locally.
2. Log in:

```bash
supabase login
```

3. Link the project after you create it:

```bash
supabase link --project-ref <your-project-ref>
```

4. Push the schema:

```bash
supabase db push
```

## Required Tables

The migrations currently define:

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

## App Variables To Fill Later

When the project exists, set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
