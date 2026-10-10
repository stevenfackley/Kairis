-- Paper fills model a taker fee (PAPER_TAKER_FEE_RATE in lib/domain/strategy.ts). Buy fees are part of
-- the position's cost basis and sell fees come out of the proceeds, so realized_pnl_usd on a sell is net
-- of both legs. numeric(18,8) like assisted_orders.total_fees, so the stored fee is exactly the one the
-- fill was computed with. Null on blocked rows and on fills recorded before fees were modeled; those are
-- rebuilt as fee-free. Idempotent: safe to re-run.

alter table paper_trades
  add column if not exists fee_usd numeric(18,8);
