import { DUST_BASE_SIZE, PAPER_TAKER_FEE_RATE } from "@/lib/domain/strategy";
import type { DayStats, OrderIntent, Position, PositionMap } from "@/lib/types";

/** `feeUsd` null or missing means no fee was recorded (fills from before fees were modeled). */
export type Fill = {
  productId: string;
  side: "BUY" | "SELL";
  baseSize: number;
  price: number;
  feeUsd?: number | null;
  realizedPnlUsd: number;
  createdAt: string;
  status: string;
};
export type Lot = { baseSize: number; avgCost: number };

// quantity and entry_price are numeric(18,8): fills are rounded to what the database keeps, so a
// position rebuilt from stored rows matches the one the fill was computed against.
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const finiteOr0 = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** True for a size too small to be a real holding (dust), and for anything non-finite. */
export function isFlat(baseSize: number): boolean {
  return !(Math.abs(baseSize) >= DUST_BASE_SIZE);
}

/**
 * Applies one fill to the running average-cost lots. A buy adds its notional plus its fee to the cost
 * basis; a sell reduces the size and leaves the average cost alone; a dust remainder resets to flat so a
 * later buy starts a fresh average.
 */
export function applyFill(lots: Record<string, Lot>, f: Fill): void {
  const cur = lots[f.productId] ?? { baseSize: 0, avgCost: 0 };
  if (f.side === "BUY") {
    const size = cur.baseSize + f.baseSize;
    const cost = cur.baseSize * cur.avgCost + f.baseSize * f.price + finiteOr0(f.feeUsd);
    lots[f.productId] = size > 0 ? { baseSize: size, avgCost: cost / size } : cur;
    return;
  }
  const remaining = cur.baseSize - f.baseSize;
  lots[f.productId] = isFlat(remaining) || remaining < 0 ? { baseSize: 0, avgCost: 0 } : { baseSize: remaining, avgCost: cur.avgCost };
}

/** Average-cost positions from fills, in time order. `prices` supplies the mark for notional (average cost when missing). */
export function buildPositions(fills: ReadonlyArray<Fill>, prices: Record<string, number>): PositionMap {
  const sorted = [...fills].filter((f) => f.status === "filled").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lots: Record<string, Lot> = {};
  for (const f of sorted) applyFill(lots, f);
  const out: PositionMap = {};
  for (const [productId, p] of Object.entries(lots)) {
    if (isFlat(p.baseSize)) continue;
    const mark = prices[productId] ?? p.avgCost;
    out[productId] = { baseSize: p.baseSize, avgCost: p.avgCost, notionalUsd: p.baseSize * mark };
  }
  return out;
}

/**
 * Realized P&L of selling `size` at `price` with `feeUsd` charged, against the held average cost (which
 * already carries the buy fees). Only the held part realizes; the fee is pro-rated to it.
 */
export function realizeSell(held: Lot | undefined, size: number, price: number, feeUsd: number): number {
  if (!held || isFlat(held.baseSize) || !(size > 0)) return 0;
  const realized = Math.min(size, held.baseSize);
  const fee = finiteOr0(feeUsd) * (realized / size);
  return realized * price - fee - realized * held.avgCost;
}

/**
 * Simulated taker fill at the reference price. The fee is `feeRate` of the filled notional. A sell is
 * capped at the held size, and closes the whole position when only dust would remain or when
 * `closePosition` asks for exactly that.
 */
export function fillPaperOrder(
  positions: Record<string, Position | undefined>,
  intent: OrderIntent,
  referencePrice: number,
  feeRate: number = PAPER_TAKER_FEE_RATE,
  opts: { closePosition?: boolean } = {}
): { baseSize: number; price: number; feeUsd: number; realizedPnlUsd: number } {
  const price = round8(referencePrice);
  const requested = price > 0 ? round8(intent.quoteUsd / price) : 0;
  if (intent.side === "BUY") {
    return { baseSize: requested, price, feeUsd: round8(requested * price * feeRate), realizedPnlUsd: 0 };
  }
  const held = positions[intent.productId];
  const heldSize = held && !isFlat(held.baseSize) ? held.baseSize : 0;
  let size = Math.min(requested, heldSize);
  if (opts.closePosition || isFlat(heldSize - size)) size = heldSize;
  const feeUsd = round8(size * price * feeRate);
  return { baseSize: size, price, feeUsd, realizedPnlUsd: realizeSell(held, size, price, feeUsd) };
}

/**
 * Stats for the current UTC day (00:00-24:00 UTC), used by the risk engine and shown as "today (UTC)".
 * Only filled orders count: a blocked attempt is not a trade. Only sells realize P&L, so a buy (fee and
 * all) never counts as a loss; a sell with any realized loss, fees included, does.
 */
export function dayStats(trades: ReadonlyArray<{ createdAt: string; status: string; realizedPnlUsd: number }>, now: Date): DayStats {
  const day = now.toISOString().slice(0, 10);
  const today = trades.filter((t) => t.status === "filled" && t.createdAt.slice(0, 10) === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let consecutiveLosses = 0;
  let lastLossAt: string | null = null;
  for (const t of today) {
    if (t.realizedPnlUsd < 0) { consecutiveLosses += 1; lastLossAt = t.createdAt; } else if (t.realizedPnlUsd > 0) consecutiveLosses = 0;
  }
  return { tradesCount: today.length, realizedPnlUsd: today.reduce((a, t) => a + t.realizedPnlUsd, 0), consecutiveLosses, lastLossAt };
}
