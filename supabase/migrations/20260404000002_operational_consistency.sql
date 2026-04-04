alter table public.audit_events
  drop constraint if exists audit_events_category_check;

alter table public.audit_events
  add constraint audit_events_category_check
  check (category in ('onboarding', 'limits', 'paper-trade', 'assisted-order', 'operations', 'export'));

alter table public.assisted_orders
  add column if not exists user_id text;

update public.assisted_orders
set user_id = 'demo-user'
where user_id is null;

alter table public.assisted_orders
  alter column user_id set not null;

create index if not exists idx_assisted_orders_user_created_at
  on public.assisted_orders (user_id, created_at desc);
