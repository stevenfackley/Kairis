-- v1 product schema. Fully idempotent: safe to re-run on a database that already has it.
-- Check constraint names below are the ones Postgres generated for the inline checks in
-- migration 1 (<table>_<column>_check); migration 2 already re-created audit_events_category_check.

create table if not exists users (
  id text primary key,
  email text,
  display_name text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table trading_limits
  add column if not exists per_symbol_max_usd jsonb not null default '{}'::jsonb,
  add column if not exists trading_paused boolean not null default false,
  add column if not exists loss_streak_trigger integer not null default 2;

create table if not exists exchange_connections (
  user_id text primary key,
  provider text not null check (provider in ('coinbase')),
  key_id text not null,
  secret_ciphertext text not null,
  secret_iv text not null,
  secret_tag text not null,
  can_view boolean not null,
  can_trade boolean not null,
  can_transfer boolean not null,
  portfolio_uuid text,
  validated_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  action text not null check (action in ('long', 'observe', 'blocked')),
  setup text not null,
  rationale jsonb not null,
  strength numeric(4,3) not null,
  reference_price numeric(18,8) not null,
  atr_pct numeric(8,4),
  rsi numeric(8,4),
  spread_pct numeric(8,4),
  data_age_ms integer not null,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_signals_product_evaluated
  on signals (product_id, evaluated_at desc);

alter table paper_trades
  add column if not exists quote_usd numeric(12,2) not null default 0,
  add column if not exists realized_pnl_usd numeric(12,2) not null default 0,
  add column if not exists signal_id uuid,
  add column if not exists risk_decision jsonb;

alter table assisted_orders
  add column if not exists order_id text,
  add column if not exists client_order_id text,
  add column if not exists preview_id text,
  add column if not exists exchange_status text,
  add column if not exists filled_size numeric(18,8),
  add column if not exists average_price numeric(18,8),
  add column if not exists total_fees numeric(18,8),
  add column if not exists signal_id uuid,
  add column if not exists risk_decision jsonb,
  add column if not exists submit_claimed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table assisted_orders
  drop constraint if exists assisted_orders_status_check;

alter table assisted_orders
  add constraint assisted_orders_status_check
  check (status in ('previewed', 'submitted', 'blocked', 'filled', 'cancelled', 'failed', 'expired'));

create unique index if not exists idx_assisted_orders_client_order_id
  on assisted_orders (client_order_id)
  where client_order_id is not null;

alter table audit_events
  drop constraint if exists audit_events_category_check;

alter table audit_events
  add constraint audit_events_category_check
  check (category in ('auth', 'onboarding', 'limits', 'signal', 'risk', 'paper-trade', 'assisted-order', 'exchange', 'export', 'operations', 'auto'));

alter table export_artifacts
  drop constraint if exists export_artifacts_type_check;

alter table export_artifacts
  add constraint export_artifacts_type_check
  check (type in ('paper-journal', 'assisted-orders', 'audit-log'));
