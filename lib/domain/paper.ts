import type { DayStats, OrderIntent, PaperTrade, Position, PositionMap } from "@/lib/types";

type Fill = { productId: string; side: "BUY" | "SELL"; baseSize: number; price: number; realizedPnlUsd: number; createdAt: string; status: string };

/** Average-cost positions from fills, in time order. `prices` supplies the mark for notional. */
export function buildPositions(fills: ReadonlyArray<Fill>, prices: Record<string, number>): PositionMap {
  const sorted = [...fills].filter((f) => f.status === "filled").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const acc: Record<string, { baseSize: number; avgCost: number }> = {};
  for (const f of sorted) {
    const cur = acc[f.productId] ?? { baseSize: 0, avgCost: 0 };
    if (f.side === "BUY") {
      const cost = cur.baseSize * cur.avgCost + f.baseSize * f.price;
      const size = cur.baseSize + f.baseSize;
      acc[f.productId] = { baseSize: size, avgCost: size > 0 ? cost / size : 0 };
    } else {
      acc[f.productId] = { baseSize: Math.max(0, cur.baseSize - f.baseSize), avgCost: cur.avgCost };
    }
  }
  const out: PositionMap = {};
  for (const [productId, p] of Object.entries(acc)) {
    if (p.baseSize <= 1e-12) continue;
    const mark = prices[productId] ?? p.avgCost;
    out[productId] = { baseSize: p.baseSize, avgCost: p.avgCost, notionalUsd: p.baseSize * mark };
  }
  return out;
}

/** Simulated fill at the reference price. Sells realize P&L against the average cost. */
export function fillPaperOrder(positions: Record<string, Position | undefined>, intent: OrderIntent, referencePrice: number): { baseSize: number; price: number; realizedPnlUsd: number } {
  const baseSize = intent.quoteUsd / referencePrice;
  if (intent.side === "BUY") return { baseSize, price: referencePrice, realizedPnlUsd: 0 };
  const held = positions[intent.productId];
  const size = Math.min(baseSize, held?.baseSize ?? 0);
  const realizedPnlUsd = held ? (referencePrice - held.avgCost) * size : 0;
  return { baseSize: size, price: referencePrice, realizedPnlUsd };
}

/** UTC-day stats used by the risk engine. */
export function dayStats(trades: ReadonlyArray<Pick<PaperTrade, "createdAt" | "status" | "realizedPnlUsd">>, now: Date): DayStats {
  const day = now.toISOString().slice(0, 10);
  const today = trades.filter((t) => t.status === "filled" && t.createdAt.slice(0, 10) === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let consecutiveLosses = 0;
  let lastLossAt: string | null = null;
  for (const t of today) {
    if (t.realizedPnlUsd < 0) { consecutiveLosses += 1; lastLossAt = t.createdAt; } else if (t.realizedPnlUsd > 0) consecutiveLosses = 0;
  }
  return { tradesCount: today.length, realizedPnlUsd: today.reduce((a, t) => a + t.realizedPnlUsd, 0), consecutiveLosses, lastLossAt };
}
