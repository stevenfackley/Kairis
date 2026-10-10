import { num, usd } from "@/lib/format";
import type { OrderSize, Side } from "@/lib/types";

/**
 * Trading rules for one product, from GET /api/v3/brokerage/market/products/{product_id}.
 * Sizes stay decimal strings so increments are applied exactly.
 */
export type ProductRules = {
  productId: string;
  baseCurrency: string;
  status: string;
  baseIncrement: string;
  quoteIncrement: string;
  baseMinSize: string;
  baseMaxSize: string;
  quoteMinSize: string;
  quoteMaxSize: string;
  isDisabled: boolean;
  tradingDisabled: boolean;
  cancelOnly: boolean;
  limitOnly: boolean;
  postOnly: boolean;
  viewOnly: boolean;
};

/** A sell may be sized down to the Coinbase balance when the gap is fee-sized (taker fees reach 1.2%). */
export const SELL_SHORTFALL_TOLERANCE = 0.02;

// ---------------------------------------------------------------------------------------------------
// Exact decimal helpers. Coinbase increments such as 0.00000001 do not survive float arithmetic, so
// sizes are floored on scaled integers.

const DECIMAL = /^\d+(\.\d+)?$/;

/** The shortest round-trip decimal for a non-negative finite number, never in exponent form. */
export function decimalString(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Not a non-negative finite size: ${n}`);
  }
  const s = String(n);
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (!m) return s;
  const digits = m[1]! + (m[2] ?? "");
  const point = m[1]!.length + Number(m[3]);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function fractionLength(value: string): number {
  return (value.split(".")[1] ?? "").length;
}

function toUnits(value: string, scale: number): bigint {
  if (!DECIMAL.test(value)) {
    throw new Error(`Not a plain decimal: ${value}`);
  }
  const [int, frac = ""] = value.split(".");
  return BigInt(int! + (frac + "0".repeat(scale)).slice(0, scale));
}

function fromUnits(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const s = units.toString().padStart(scale + 1, "0");
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`.replace(/\.?0+$/, "");
}

/** `value` rounded down to a whole number of `increment`s ("0.0012059602", "0.00000001" -> "0.00120596"). */
export function floorToIncrement(value: string, increment: string): string {
  const scale = fractionLength(increment);
  const v = toUnits(value, scale);
  const inc = toUnits(increment, scale);
  return fromUnits(inc > 0n ? (v / inc) * inc : v, scale);
}

export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(fractionLength(a), fractionLength(b));
  const x = toUnits(a, scale);
  const y = toUnits(b, scale);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function isMultipleOf(value: string, increment: string): boolean {
  const scale = Math.max(fractionLength(value), fractionLength(increment));
  const inc = toUnits(increment, scale);
  return inc === 0n || toUnits(value, scale) % inc === 0n;
}

function positive(value: string): boolean {
  return compareDecimal(value, "0") > 0;
}

// ---------------------------------------------------------------------------------------------------

/** Why Coinbase will not take a market order in this product right now, or null when it will. */
export function marketOrderBlocker(rules: ProductRules): string | null {
  const id = rules.productId;
  if (rules.isDisabled || rules.tradingDisabled) return `${id} is disabled for trading on Coinbase right now.`;
  if (rules.cancelOnly) return `${id} is in cancel-only mode on Coinbase: new orders are not accepted.`;
  if (rules.limitOnly) return `${id} accepts only limit orders on Coinbase right now, and Kairis places market orders.`;
  if (rules.postOnly) return `${id} accepts only post-only limit orders on Coinbase right now, and Kairis places market orders.`;
  if (rules.viewOnly) return `${id} is view-only on Coinbase.`;
  if (rules.status !== "" && rules.status.toLowerCase() !== "online") return `Coinbase lists ${id} as "${rules.status}", not online.`;
  return null;
}

export type SizingInput = {
  side: Side;
  /** Dollars to spend (BUY) or the dollar value to sell (SELL). Ignored when baseSize is given. */
  quoteUsd: number;
  /** The price the risk check used; converts a SELL's dollars to coins. */
  price: number;
  rules: ProductRules;
  /** SELL only: sell exactly this many coins (closing a position) instead of converting quoteUsd. */
  baseSize?: number | null;
  /** SELL only: the coins Coinbase reports available. Unknown (null) skips the balance check. */
  availableBase?: number | null;
};

export type SizingResult =
  | { ok: true; size: OrderSize; notionalUsd: number; note: string | null }
  | { ok: false; reason: string };

const coins = (value: string | number) => num(Number(value), 8);

/**
 * Sizes a market IOC order the way Coinbase Advanced Trade requires: a BUY by quote_size, a SELL by
 * base_size ("To buy a product, provide a quote_size or base_size; to sell, provide a base_size",
 * Advanced Trade orders guide). Sizes are rounded DOWN to the product's increment, so a buy never
 * spends more than asked and a sell never sells more than intended or held.
 */
export function sizeMarketOrder(input: SizingInput): SizingResult {
  const { rules, side } = input;
  const blocker = marketOrderBlocker(rules);
  if (blocker) return { ok: false, reason: blocker };
  const id = rules.productId;
  const ccy = rules.baseCurrency;

  if (side === "BUY") {
    if (!(Number.isFinite(input.quoteUsd) && input.quoteUsd > 0)) {
      return { ok: false, reason: "Order size must be a positive dollar amount." };
    }
    const quote = floorToIncrement(decimalString(input.quoteUsd), rules.quoteIncrement);
    if (!positive(quote) || compareDecimal(quote, rules.quoteMinSize) < 0) {
      return { ok: false, reason: `The smallest ${id} buy Coinbase accepts is ${usd(Number(rules.quoteMinSize))}.` };
    }
    if (positive(rules.quoteMaxSize) && compareDecimal(quote, rules.quoteMaxSize) > 0) {
      return { ok: false, reason: `The largest ${id} market buy Coinbase accepts is ${usd(Number(rules.quoteMaxSize))}.` };
    }
    return { ok: true, size: { kind: "quote", quoteSize: quote }, notionalUsd: Number(quote), note: null };
  }

  if (!(Number.isFinite(input.price) && input.price > 0)) {
    return { ok: false, reason: `There is no current ${id} price to size the sell; try again shortly.` };
  }
  let wanted: number;
  if (input.baseSize !== undefined && input.baseSize !== null) {
    wanted = input.baseSize;
  } else {
    if (!(Number.isFinite(input.quoteUsd) && input.quoteUsd > 0)) {
      return { ok: false, reason: "Order size must be a positive dollar amount." };
    }
    wanted = input.quoteUsd / input.price;
  }
  if (!(Number.isFinite(wanted) && wanted > 0)) {
    return { ok: false, reason: `There is no ${id} position to sell.` };
  }
  let base = floorToIncrement(decimalString(wanted), rules.baseIncrement);
  let note: string | null = null;

  if (input.availableBase !== undefined && input.availableBase !== null && Number.isFinite(input.availableBase)) {
    const available = floorToIncrement(decimalString(Math.max(0, input.availableBase)), rules.baseIncrement);
    if (compareDecimal(base, available) > 0) {
      const closeEnough = positive(available) && Number(available) >= Number(base) * (1 - SELL_SHORTFALL_TOLERANCE);
      if (!closeEnough) {
        return {
          ok: false,
          reason: `Coinbase shows ${coins(available)} ${ccy} available (about ${usd(Number(available) * input.price)}), less than the ${coins(base)} ${ccy} this sell needs.`
        };
      }
      note = `Sized down from ${coins(base)} to the ${coins(available)} ${ccy} available on Coinbase.`;
      base = available;
    }
  }

  if (!positive(base) || compareDecimal(base, rules.baseMinSize) < 0) {
    return {
      ok: false,
      reason: `This sell comes to ${coins(base)} ${ccy}, below the ${coins(rules.baseMinSize)} ${ccy} minimum Coinbase accepts for ${id}.`
    };
  }
  if (positive(rules.baseMaxSize) && compareDecimal(base, rules.baseMaxSize) > 0) {
    return { ok: false, reason: `The largest ${id} market sell Coinbase accepts is ${coins(rules.baseMaxSize)} ${ccy}.` };
  }
  return { ok: true, size: { kind: "base", baseSize: base }, notionalUsd: Number(base) * input.price, note };
}

/**
 * The PreviewFailureReason codes Coinbase would return for this size. The mock provider uses it so a
 * mock user meets the same refusals a live user would.
 */
export function sizeViolations(side: Side, size: OrderSize, rules: ProductRules): string[] {
  const out: string[] = [];
  if (rules.isDisabled || rules.tradingDisabled || rules.cancelOnly || rules.viewOnly) out.push("PREVIEW_TRADING_DISABLED");
  else if (rules.limitOnly || rules.postOnly) out.push("PREVIEW_NOT_ALLOWED_BY_MARKET_STATE");
  if (side === "SELL" && size.kind === "quote") {
    out.push("PREVIEW_INVALID_ORDER_CONFIG");
    return out;
  }
  if (size.kind === "quote") {
    if (!DECIMAL.test(size.quoteSize)) return [...out, "PREVIEW_NON_NUMERIC_ORDER_SIZE"];
    if (!isMultipleOf(size.quoteSize, rules.quoteIncrement)) out.push("PREVIEW_INVALID_QUOTE_SIZE_PRECISION");
    if (compareDecimal(size.quoteSize, rules.quoteMinSize) < 0 || !positive(size.quoteSize)) out.push("PREVIEW_INVALID_QUOTE_SIZE_TOO_SMALL");
    if (positive(rules.quoteMaxSize) && compareDecimal(size.quoteSize, rules.quoteMaxSize) > 0) out.push("PREVIEW_INVALID_QUOTE_SIZE_TOO_LARGE");
  } else {
    if (!DECIMAL.test(size.baseSize)) return [...out, "PREVIEW_NON_NUMERIC_ORDER_SIZE"];
    if (!isMultipleOf(size.baseSize, rules.baseIncrement)) out.push("PREVIEW_INVALID_SIZE_PRECISION");
    if (compareDecimal(size.baseSize, rules.baseMinSize) < 0 || !positive(size.baseSize)) out.push("PREVIEW_INVALID_BASE_SIZE_TOO_SMALL");
    if (positive(rules.baseMaxSize) && compareDecimal(size.baseSize, rules.baseMaxSize) > 0) out.push("PREVIEW_INVALID_BASE_SIZE_TOO_LARGE");
  }
  return out;
}

/** "spend $100.00" / "sell 0.00120596 BTC", for previews, details and audit lines. */
export function describeSize(size: OrderSize, productId: string): string {
  return size.kind === "quote" ? `spend ${usd(Number(size.quoteSize))}` : `sell ${coins(size.baseSize)} ${productId.split("-")[0]}`;
}
