# Database

## Where it lives

- **Prod:** qavren-db, one Supabase Pro project shared by the Qavren apps. Kairis owns the schema
  `kairis` and logs in as the role `kairis`, which has no grants on other apps' schemas. The role's
  `search_path` is `kairis, extensions`, so the code uses unqualified table names.
- **Local:** `compose.dev.yaml`, Postgres 17 on `127.0.0.1:55433`, user, password and database `kairis`.
  Tables land in `public` there; the code does not care.
- **Backups:** qavren-db runs nightly per-schema dumps to R2, on top of Supabase's daily backups.

## Connections

| Use | Port | Mode | Where it is set |
|---|---|---|---|
| App runtime | 6543 | Supavisor transaction pooler | `DATABASE_URL` in the host `.env` |
| Migrations | 5432 | Session mode, as the `kairis` role | `QAVREN_DB_PROD_SESSION_URL` (GitHub environment secret) |

Through the pooler the user is `kairis.<project-ref>`. Both ports use TLS without certificate pinning
for any host other than localhost.

Transaction pooling means consecutive statements may run on different server connections. App code
therefore uses no `SET`, no named prepared statements and no advisory locks across statements. Keep it
that way. Each migration runs in one explicit transaction, so it stays on one connection.

## Migrations

- Files live in `db/migrations/` and are applied in file-name order. Name a new one
  `YYYYMMDDHHMMSS_description.sql`. Never edit a file that has been applied; add a new one.
- Write idempotent SQL where you can (`create table if not exists`, `add column if not exists`, drop and
  re-add constraints). Additive changes keep the previous image working while a deploy is in progress.
- `npm run db:migrate` runs `scripts/db-migrate.mjs`. It reads `.env` then `.env.local` without overriding
  the shell, creates `schema_migrations (name, applied_at)` if missing, skips recorded names, and runs
  each new file in a transaction together with its `schema_migrations` row. A failure rolls that file
  back and stops.
- The deploy job runs the same script against prod with `QAVREN_DB_PROD_SESSION_URL`, before
  `docker compose up`.
- The first two migrations predate tracking. On a database that already has their tables the first
  tracked run re-applies them harmlessly and records them.

## Local reset

    npm run db:down
    docker volume rm kairis-dev_kairis-dev-db
    npm run db:up
    npm run db:migrate

The integration tests truncate every table. They only run against a localhost `DATABASE_URL` unless
`KAIRIS_ALLOW_REMOTE_TEST_DB=true`.

## Tables

| Table | Key | Holds |
|---|---|---|
| `users` | `id` (Keycloak sub) | email, display name, owner flag, first and last seen |
| `onboarding_states` | `user_id` | preferred mode, risk acknowledgment, exchange connected |
| `trading_limits` | `user_id` | max position, daily loss cap, trades per day, cooldown, loss streak trigger, per-symbol caps (jsonb), pause flag |
| `exchange_connections` | `user_id` | Coinbase key name, sealed private key (ciphertext, iv, tag), permission flags, validation time |
| `signals` | `id` | every signal evaluation: action, setup, rationale (jsonb), strength, indicators, data age |
| `paper_trades` | `id` | paper fills and blocked attempts, quote size, realized P&L, risk decision (jsonb) |
| `assisted_orders` | `id`, also the exchange `client_order_id` | assisted orders: status, exchange order id and status, fills, fees, risk decision |
| `audit_events` | `id` | decisions and actions by category (auth, onboarding, limits, signal, risk, paper-trade, assisted-order, exchange, export, operations, auto) |
| `export_artifacts` | `id` | CSV exports (paper journal, assisted orders, audit log) and where each is stored |
| `schema_migrations` | `name` | applied migration files |
