# Supabase Setup

## Current State

The repository now contains a local `supabase/` project skeleton and SQL migration set, but the cloud project is not linked yet.

## Files

- `supabase/config.toml`
- `supabase/migrations/20260404_000001_core_phase4_phase5.sql`

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

The migration currently defines:

- `onboarding_states`
- `trading_limits`
- `paper_trades`
- `audit_events`
- `export_artifacts`
- `assisted_orders`

## App Variables To Fill Later

When the project exists, set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
