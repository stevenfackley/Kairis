import { buildPositions, dayStats, fillPaperOrder } from "@/lib/domain/paper";
import { evaluateRisk } from "@/lib/domain/risk";
import { STRATEGY } from "@/lib/domain/strategy";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits } from "@/lib/server/repos/limits";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { getMarketSnapshot, getReferencePrices, marketDataAgeMs, type MarketSnapshot } from "@/lib/server/services/market";
import type { AssistedOrder, OrderIntent, RiskContext, RiskDecision, Side, TradeMode } from "@/lib/types";

type Fill = { productId: string; side: Side; baseSize: number; price: number; realizedPnlUsd: number; createdAt: string; status: "filled" };

// Positions and day stats are rebuilt from the full history; the list repos default to small pages.
const HISTORY_LIMIT = 100_000;

async function snapshotOrNull(productId: string): Promise<MarketSnapshot | null> {
  try {
    return await getMarketSnapshot(productId);
  } catch {
    return null;
  }
}

function sortByTime<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// An order counts toward exposure when it filled, when it is still in flight (a submitted market IOC
// order almost always fills before reconcile runs, so ignoring it would let rapid submits stack past
// the limits), or when a terminal non-fill status still reports a partial fill.
function liveExposure(order: AssistedOrder): boolean {
  if (order.status === "filled" || order.status === "submitted") {
    return true;
  }
  const partial = order.status === "cancelled" || order.status === "expired" || order.status === "failed";
  return partial && (order.filledSize ?? 0) > 0;
}

// Live P&L is rebuilt from the orders Kairis itself recorded, in time order. Trades made outside Kairis
// (the Coinbase app, other bots) are invisible here, so live limits apply to Kairis trades only.
// Fees are left out of realized P&L: charging them to buys would count every entry as a loss.
function liveFills(exposure: AssistedOrder[], prices: Record<string, number>): Fill[] {
  const fills: Fill[] = [];
  for (const order of sortByTime(exposure)) {
    const price = order.averagePrice ?? prices[order.productId] ?? 0;
    const baseSize = order.filledSize ?? (price > 0 ? order.quoteUsd / price : 0);
    let realizedPnlUsd = 0;
    if (order.side === "SELL" && price > 0 && baseSize > 0) {
      const held = buildPositions(fills, {});
      realizedPnlUsd = fillPaperOrder(held, { productId: order.productId, side: "SELL", quoteUsd: baseSize * price, mode: "live" }, price).realizedPnlUsd;
    }
    fills.push({ productId: order.productId, side: order.side, baseSize, price, realizedPnlUsd, createdAt: order.createdAt, status: "filled" });
  }
  return fills;
}

async function historyFills(userId: string, mode: TradeMode, productId: string): Promise<{ fills: Fill[]; prices: Record<string, number> }> {
  if (mode === "paper") {
    const trades = await listPaperTrades(userId, HISTORY_LIMIT);
    const fills: Fill[] = trades
      .filter((t) => t.status === "filled")
      .map((t): Fill => ({ productId: t.productId, side: t.side, baseSize: t.baseSize, price: t.price, realizedPnlUsd: t.realizedPnlUsd, createdAt: t.createdAt, status: "filled" }));
    const held = Object.keys(buildPositions(fills, {}));
    return { fills, prices: await getReferencePrices([...held, productId]) };
  }
  const orders = (await listAssistedOrders(userId, HISTORY_LIMIT)).filter(liveExposure);
  // Unfilled in-flight orders have no average price yet, so every traded product needs a mark.
  const prices = await getReferencePrices([...orders.map((o) => o.productId), productId]);
  return { fills: liveFills(orders, prices), prices };
}

export async function buildRiskContext(userId: string, mode: TradeMode, productId: string): Promise<RiskContext> {
  const now = new Date();
  const [limits, snapshot, history] = await Promise.all([getLimits(userId), snapshotOrNull(productId), historyFills(userId, mode, productId)]);
  return {
    limits,
    today: dayStats(history.fills, now),
    positions: buildPositions(history.fills, history.prices),
    // No snapshot: price 0 and providerDegraded, which halts on its own. The age is unknown, not stale,
    // so it stays 0 rather than inventing a number for the fresh-data check.
    referencePrice: snapshot ? snapshot.ticker.price : 0,
    dataAgeMs: snapshot ? marketDataAgeMs(snapshot, now.getTime()) : 0,
    maxDataAgeMs: STRATEGY.maxTickerAgeMs,
    providerDegraded: snapshot === null,
    now
  };
}

export async function checkOrder(userId: string, intent: OrderIntent): Promise<{ decision: RiskDecision; context: RiskContext }> {
  const context = await buildRiskContext(userId, intent.mode, intent.productId);
  const decision = evaluateRisk(context, intent);
  await appendAudit(
    userId,
    "risk",
    decision.outcome,
    `${intent.mode} ${intent.side} ${intent.productId} $${intent.quoteUsd}: ${decision.reasons.join(" ") || "approved"}`
  );
  return { decision, context };
}
