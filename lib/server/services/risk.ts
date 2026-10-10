import { applyFill, buildPositions, dayStats, isFlat, realizeSell, type Fill, type Lot } from "@/lib/domain/paper";
import { evaluateRisk } from "@/lib/domain/risk";
import { STRATEGY, TAKER_FEE_RATE } from "@/lib/domain/strategy";
import { usd } from "@/lib/format";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits } from "@/lib/server/repos/limits";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { getMarketSnapshot, getReferencePrices, marketDataAgeMs, type MarketSnapshot } from "@/lib/server/services/market";
import { isUnknownProductError } from "@/lib/server/services/shared";
import type { AssistedOrder, OrderIntent, RiskContext, RiskDecision, TradeMode } from "@/lib/types";

// Positions and day stats are rebuilt from the full history; the list repos default to small pages.
export const HISTORY_LIMIT = 100_000;

type SnapshotResult = { snapshot: MarketSnapshot | null; unknownProduct: boolean };

// A failed fetch is an outage (halt) unless Coinbase said the product does not exist (block).
async function snapshotFor(productId: string): Promise<SnapshotResult> {
  try {
    return { snapshot: await getMarketSnapshot(productId), unknownProduct: false };
  } catch (error) {
    return { snapshot: null, unknownProduct: isUnknownProductError(error) };
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

/**
 * Coins and fee of an in-flight order Coinbase has not reported a fill for yet, estimated the way Coinbase
 * will charge it at the entry-tier taker rate. A quote-sized BUY spends its quote including the fee, so it
 * gets quote / (1 + rate) / price coins (quote / price would overstate them by the fee) and its cost basis
 * stays the quote; a coin-sized order is exactly its base size and a sell pays the fee out of its proceeds.
 * The size recorded at preview (the one submitted) is used when present, else the order's dollars.
 */
function inFlightEstimate(order: AssistedOrder, price: number): { baseSize: number; feeUsd: number } {
  if (!(price > 0)) return { baseSize: 0, feeUsd: 0 };
  const size = order.orderSize;
  if (size?.kind === "base") {
    const baseSize = Number(size.baseSize);
    return { baseSize, feeUsd: baseSize * price * TAKER_FEE_RATE };
  }
  const quote = size?.kind === "quote" ? Number(size.quoteSize) : order.quoteUsd;
  if (order.side === "BUY") {
    const filledValue = quote / (1 + TAKER_FEE_RATE);
    return { baseSize: filledValue / price, feeUsd: quote - filledValue };
  }
  return { baseSize: quote / price, feeUsd: quote * TAKER_FEE_RATE };
}

// Live P&L is rebuilt from the orders Kairis itself recorded, in time order. Trades made outside Kairis
// (the Coinbase app, other bots) are invisible here, so live limits apply to Kairis trades only.
// Exchange-reported fees are charged the same way as paper fees: a buy's fee goes into the cost basis
// (so a buy never realizes a loss) and a sell's fee (Coinbase's totalFees) comes out of its proceeds. An
// in-flight order is estimated (inFlightEstimate) until reconcile records what Coinbase reports.
function liveFills(exposure: AssistedOrder[], prices: Record<string, number>): Fill[] {
  const fills: Fill[] = [];
  const lots: Record<string, Lot> = {};
  for (const order of sortByTime(exposure)) {
    const price = order.averagePrice ?? prices[order.productId] ?? 0;
    const estimate = order.filledSize === null ? inFlightEstimate(order, price) : null;
    const baseSize = estimate ? estimate.baseSize : (order.filledSize ?? 0);
    const feeUsd = estimate ? estimate.feeUsd : (order.totalFees ?? 0);
    const realizedPnlUsd = order.side === "SELL" && price > 0 && baseSize > 0 ? realizeSell(lots[order.productId], baseSize, price, feeUsd) : 0;
    const fill: Fill = { productId: order.productId, side: order.side, baseSize, price, feeUsd, realizedPnlUsd, createdAt: order.createdAt, status: "filled" };
    applyFill(lots, fill);
    fills.push(fill);
  }
  return fills;
}

async function historyFills(userId: string, mode: TradeMode, productId: string): Promise<{ fills: Fill[]; prices: Record<string, number> }> {
  if (mode === "paper") {
    const trades = await listPaperTrades(userId, HISTORY_LIMIT);
    const fills: Fill[] = trades
      .filter((t) => t.status === "filled")
      .map((t): Fill => ({
        productId: t.productId,
        side: t.side,
        baseSize: t.baseSize,
        price: t.price,
        feeUsd: t.feeUsd,
        realizedPnlUsd: t.realizedPnlUsd,
        createdAt: t.createdAt,
        status: "filled"
      }));
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
  const [limits, market, history] = await Promise.all([getLimits(userId), snapshotFor(productId), historyFills(userId, mode, productId)]);
  const { snapshot, unknownProduct } = market;
  return {
    limits,
    today: dayStats(history.fills, now),
    positions: buildPositions(history.fills, history.prices),
    // No snapshot: price 0 and either providerDegraded (an outage, which halts) or unknownProduct (Coinbase
    // does not list it, which blocks). The age is unknown, not stale, so it stays 0 rather than inventing
    // a number for the fresh-data check.
    referencePrice: snapshot ? snapshot.ticker.price : 0,
    dataAgeMs: snapshot ? marketDataAgeMs(snapshot, now.getTime()) : 0,
    maxDataAgeMs: STRATEGY.maxTickerAgeMs,
    providerDegraded: snapshot === null && !unknownProduct,
    unknownProduct,
    now
  };
}

/** The whole held position at the reference price, in cents (the risk check allows the one-cent round-up). */
function closeQuoteUsd(context: RiskContext, productId: string): number {
  const held = context.positions[productId];
  if (!held || isFlat(held.baseSize) || !(context.referencePrice > 0)) return 0;
  return Math.round(held.baseSize * context.referencePrice * 100) / 100;
}

/**
 * Builds the risk context, evaluates the order and audits the decision. With `closePosition` the order
 * sells the whole held position: its dollar size is set from the position at the current price, and the
 * returned `intent` carries that size.
 */
export async function checkOrder(
  userId: string,
  intent: OrderIntent,
  opts: { closePosition?: boolean } = {}
): Promise<{ decision: RiskDecision; context: RiskContext; intent: OrderIntent }> {
  const context = await buildRiskContext(userId, intent.mode, intent.productId);
  const resolved: OrderIntent = opts.closePosition ? { ...intent, side: "SELL", quoteUsd: closeQuoteUsd(context, intent.productId) } : intent;
  const decision = evaluateRisk(context, resolved);
  await appendAudit(
    userId,
    "risk",
    decision.outcome,
    `${resolved.mode} ${resolved.side} ${resolved.productId} ${usd(resolved.quoteUsd)}${opts.closePosition ? " (entire position)" : ""}: ${decision.reasons.join(" ") || "approved"}`
  );
  return { decision, context, intent: resolved };
}
