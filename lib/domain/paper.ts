import { DUST_BASE_SIZE, PAPER_TAKER_FEE_RATE } from "@/lib/domain/strategy";
import { compareDecimal, decimalString } from "@/lib/exchange/sizing";
import type { DayStats, OrderIntent, OrderSize, Position, PositionMap } from "@/lib/types";

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
 * Applies one fill to the running average-cost lots. A buy adds its filled value plus its fee to the cost
 * basis (for a fee-inclusive buy that is the dollars spent); a sell reduces the size and leaves the
 * average cost alone; a dust remainder resets to flat so a later buy starts a fresh average.
 * Sizes stay at the 8 decimals the database stores: float noise from adding and subtracting large sizes
 * (18,000,000 SHIB carries about 4e-9 of it) must never survive as a phantom position.
 */
export function applyFill(lots: Record<string, Lot>, f: Fill): void {
  const cur = lots[f.productId] ?? { baseSize: 0, avgCost: 0 };
  if (f.side === "BUY") {
    const size = round8(cur.baseSize + f.baseSize);
    const cost = cur.baseSize * cur.avgCost + f.baseSize * f.price + finiteOr0(f.feeUsd);
    lots[f.productId] = size > 0 ? { baseSize: size, avgCost: cost / size } : cur;
    return;
  }
  const remaining = round8(cur.baseSize - f.baseSize);
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

export type PaperFillOptions = {
  /** Sell the whole held position. */
  closePosition?: boolean;
  /**
   * The order as sized by sizeMarketOrder with Coinbase's product rules: the floored quote for a BUY, the
   * floored coins for a SELL. Without it the intent's dollars are used as they are.
   */
  size?: OrderSize | null;
  /** The product's base_increment (decimal string), for the dust rule on sells. */
  baseIncrement?: string | null;
};

/**
 * True when what a sell would leave behind is no real holding: floating-point dust, or (given the
 * product's base_increment) less than one increment, which Coinbase would never accept as a sell size, so
 * that remainder could never be sold. Paper sizes carry 8 decimals, so the remainder is compared at 8.
 */
function leavesDust(remainder: number, baseIncrement: string | null | undefined): boolean {
  if (isFlat(remainder)) return true;
  if (!baseIncrement || !(remainder > 0)) return false;
  return compareDecimal(decimalString(round8(remainder)), baseIncrement) < 0;
}

/**
 * Simulated taker fill at the reference price, charged the way Coinbase charges a market order.
 * A BUY of Q dollars spends exactly Q, fee included (Coinbase's size_inclusive_of_fees quote_size): the
 * filled value is Q / (1 + feeRate), the fee is the rest, and the coins are the filled value / price, so
 * the cost basis is Q. A SELL of N coins pays `feeRate` of its gross N * price out of the proceeds.
 *
 * A sell is capped at the held size. Dust rule: when the sell would leave less than one base_increment
 * (or float dust) behind, or `closePosition` asks for it, the fill sells the full held amount instead, so
 * a paper position is never left with a remainder too small to sell. The full amount differs from the
 * floored size by less than one increment (1e-8 BTC, 1 SHIB), worth a fraction of a cent.
 */
export function fillPaperOrder(
  positions: Record<string, Position | undefined>,
  intent: OrderIntent,
  referencePrice: number,
  feeRate: number = PAPER_TAKER_FEE_RATE,
  opts: PaperFillOptions = {}
): { baseSize: number; price: number; feeUsd: number; realizedPnlUsd: number } {
  const price = round8(referencePrice);
  if (intent.side === "BUY") {
    const quote = opts.size?.kind === "quote" ? Number(opts.size.quoteSize) : intent.quoteUsd;
    if (!(price > 0 && quote > 0)) return { baseSize: 0, price, feeUsd: 0, realizedPnlUsd: 0 };
    const filledValue = quote / (1 + feeRate);
    return { baseSize: round8(filledValue / price), price, feeUsd: round8(quote - filledValue), realizedPnlUsd: 0 };
  }
  const requested = opts.size?.kind === "base" ? Number(opts.size.baseSize) : price > 0 ? round8(intent.quoteUsd / price) : 0;
  const held = positions[intent.productId];
  const heldSize = held && !isFlat(held.baseSize) ? held.baseSize : 0;
  let size = Math.min(requested, heldSize);
  if (opts.closePosition || leavesDust(heldSize - size, opts.baseIncrement)) size = heldSize;
  const feeUsd = round8(size * price * feeRate);
  return { baseSize: size, price, feeUsd, realizedPnlUsd: realizeSell(held, size, price, feeUsd) };
}

/** Only fills this recent can build a loss streak: an old streak never starts a cooldown. */
export const STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Stats used by the risk engine and shown as "today (UTC)". The trade count and realized P&L cover the
 * current UTC day (00:00-24:00 UTC). The loss streak ignores the day boundary so a cooldown survives
 * midnight: it walks filled orders newest-first over the last 24 hours, counting realized losses until
 * the first realized gain (zero-P&L fills such as buys neither count nor break it).
 * Only filled orders count: a blocked attempt is not a trade. Only sells realize P&L, so a buy (fee and
 * all) never counts as a loss; a sell with any realized loss, fees included, does.
 */
export function dayStats(trades: ReadonlyArray<{ createdAt: string; status: string; realizedPnlUsd: number }>, now: Date): DayStats {
  const day = now.toISOString().slice(0, 10);
  const filled = trades.filter((t) => t.status === "filled");
  const today = filled.filter((t) => t.createdAt.slice(0, 10) === day);
  const cutoff = now.getTime() - STREAK_WINDOW_MS;
  const recent = filled
    .filter((t) => new Date(t.createdAt).getTime() > cutoff)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let consecutiveLosses = 0;
  let lastLossAt: string | null = null;
  for (const t of recent) {
    if (t.realizedPnlUsd > 0) break;
    if (t.realizedPnlUsd < 0) {
      consecutiveLosses += 1;
      lastLossAt ??= t.createdAt;
    }
  }
  return { tradesCount: today.length, realizedPnlUsd: today.reduce((a, t) => a + t.realizedPnlUsd, 0), consecutiveLosses, lastLossAt };
}
