create extension if not exists "pgcrypto";

create table if not exists public.onboarding_states (
  user_id text primary key,
  preferred_mode text not null check (preferred_mode in ('paper', 'manual', 'assisted', 'auto')),
  risk_acknowledged boolean not null default false,
  exchange_connected boolean not null default false,
  completed_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table if not exists public.trading_limits (
  user_id text primary key,
  max_position_usd numeric(12,2) not null,
  daily_loss_cap_usd numeric(12,2) not null,
  max_trades_per_day integer not null,
  cooldown_minutes integer not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(18,8) not null,
  entry_price numeric(18,8) not null,
  status text not null check (status in ('planned', 'filled', 'blocked')),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_paper_trades_user_created_at
  on public.paper_trades (user_id, created_at desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  category text not null check (category in ('onboarding', 'limits', 'paper-trade', 'export')),
  action text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_user_created_at
  on public.audit_events (user_id, created_at desc);

create table if not exists public.export_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null check (type in ('paper-journal')),
  storage text not null check (storage in ('r2', 'local')),
  location text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_export_artifacts_user_created_at
  on public.export_artifacts (user_id, created_at desc);

create table if not exists public.assisted_orders (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  side text not null check (side in ('BUY', 'SELL')),
  quote_size numeric(12,2) not null,
  status text not null check (status in ('previewed', 'submitted', 'blocked')),
  reconcile_state text not null check (reconcile_state in ('pending', 'reconciled', 'error')),
  reconciled_at timestamptz null,
  provider text not null check (provider in ('coinbase', 'mock')),
  detail text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_assisted_orders_created_at
  on public.assisted_orders (created_at desc);
