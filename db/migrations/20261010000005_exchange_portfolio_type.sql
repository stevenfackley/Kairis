-- key_permissions reports the portfolio a CDP key is scoped to (DEFAULT, CONSUMER, INTX).
alter table exchange_connections
  add column if not exists portfolio_type text;
