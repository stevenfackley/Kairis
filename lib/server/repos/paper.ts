import { query } from "@/lib/server/db";
import { emptyToNull, toIso, toJsonParam, toNumber, toRiskDecision, type Numeric, type Timestamp } from "@/lib/server/repos/map";
import type { PaperTrade, PaperTradeStatus } from "@/lib/types";

type PaperTradeRow = {
  id: string;
  user_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: Numeric;
  entry_price: Numeric;
  status: "planned" | "filled" | "blocked";
  note: string;
  quote_usd: Numeric;
  realized_pnl_usd: Numeric;
  signal_id: string | null;
  risk_decision: unknown;
  created_at: Timestamp;
};

const COLUMNS = "id, user_id, symbol, side, quantity, entry_price, status, note, quote_usd, realized_pnl_usd, signal_id, risk_decision, created_at";

// Legacy scaffold rows can carry status 'planned' (an intent that never executed). Map it to
// "blocked" so it never contributes to positions, day stats or realized P&L.
function mapStatus(status: PaperTradeRow["status"]): PaperTradeStatus {
  return status === "filled" ? "filled" : "blocked";
}

function mapPaperTrade(row: PaperTradeRow): PaperTrade {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.symbol,
    side: row.side === "sell" ? "SELL" : "BUY",
    baseSize: toNumber(row.quantity),
    price: toNumber(row.entry_price),
    quoteUsd: toNumber(row.quote_usd),
    status: mapStatus(row.status),
    realizedPnlUsd: toNumber(row.realized_pnl_usd),
    note: row.note,
    signalId: row.signal_id,
    riskDecision: toRiskDecision(row.risk_decision),
    createdAt: toIso(row.created_at)
  };
}

export async function insertPaperTrade(trade: PaperTrade): Promise<PaperTrade> {
  const rows = await query<PaperTradeRow>(
    `insert into paper_trades
       (id, user_id, symbol, side, quantity, entry_price, status, note, quote_usd, realized_pnl_usd, signal_id, risk_decision, created_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, coalesce($13::timestamptz, now()))
     returning ${COLUMNS}`,
    [
      emptyToNull(trade.id),
      trade.userId,
      trade.productId,
      trade.side === "SELL" ? "sell" : "buy",
      trade.baseSize,
      trade.price,
      trade.status,
      trade.note,
      trade.quoteUsd,
      trade.realizedPnlUsd,
      trade.signalId,
      toJsonParam(trade.riskDecision),
      emptyToNull(trade.createdAt)
    ]
  );
  return mapPaperTrade(rows[0]);
}

export async function listPaperTrades(userId: string, limit = 200): Promise<PaperTrade[]> {
  const rows = await query<PaperTradeRow>(
    `select ${COLUMNS} from paper_trades where user_id = $1 order by created_at desc limit $2`,
    [userId, limit]
  );
  return rows.map(mapPaperTrade);
}
