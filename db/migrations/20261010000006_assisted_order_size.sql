-- The exact market-order size sent to the exchange ({"kind":"quote","quoteSize":"100"} for a BUY,
-- {"kind":"base","baseSize":"0.00120596"} for a SELL). Stored at preview so submit sends the same size.
alter table assisted_orders
  add column if not exists order_size jsonb;
