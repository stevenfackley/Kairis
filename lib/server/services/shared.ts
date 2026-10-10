// numeric(12,2) money columns: an absurd or non-finite size still has to persist on a blocked row.
const MAX_STORABLE_USD = 9_999_999_999.99;
// numeric(18,8) columns (sizes, prices, fees): at most 10 integer digits, 8 decimals.
const MAX_NUMERIC_18_8 = 9_999_999_999.99999999;
const MIN_NUMERIC_18_8 = 0.00000001;

export function storableUsd(n: number): number {
  return Number.isFinite(n) && Math.abs(n) <= MAX_STORABLE_USD ? n : 0;
}

/** A price for a numeric(18,8) column on a row that records no fill: anything unusable becomes 0 ("n/a"). */
export function storablePrice(n: number): number {
  return Number.isFinite(n) && n >= 0 && n <= MAX_NUMERIC_18_8 ? n : 0;
}

function plain(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/**
 * Why a computed fill cannot be stored as is, in plain language, or null when every value fits its
 * column. Checked before the insert so Postgres never answers with "numeric field overflow" and NaN or
 * Infinity is never written.
 */
export function unstorableFillReason(
  productId: string,
  fill: { baseSize: number; price: number; feeUsd: number; realizedPnlUsd: number }
): string | null {
  const base = productId.split("-")[0] ?? productId;
  if (!Number.isFinite(fill.price) || fill.price < MIN_NUMERIC_18_8 || fill.price > MAX_NUMERIC_18_8) {
    return `There is no usable market price for ${productId} right now, so nothing was filled.`;
  }
  if (!Number.isFinite(fill.baseSize) || fill.baseSize > MAX_NUMERIC_18_8) {
    return `This order is too large to record: ${plain(Math.round(fill.baseSize))} ${base} is more than Kairis can store. Use a smaller order.`;
  }
  if (fill.baseSize < MIN_NUMERIC_18_8) {
    return `This order is too small to fill: at $${plain(fill.price)} it comes to less than 0.00000001 ${base}.`;
  }
  const money = [fill.feeUsd, fill.realizedPnlUsd];
  if (money.some((n) => !Number.isFinite(n) || Math.abs(n) > MAX_STORABLE_USD)) {
    return "This order's fee or realized P&L is too large to record. Use a smaller order.";
  }
  return null;
}

export function errorMessage(error: unknown, fallback = "Unknown error."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const UNKNOWN_PRODUCT = "UNKNOWN_PRODUCT";

/** Coinbase answered "not found" for a product: the order is wrong, the provider is fine. */
export class UnknownProductError extends Error {
  readonly code = UNKNOWN_PRODUCT;
  constructor(readonly productId: string) {
    super(`${productId} is not a tradable Coinbase pair.`);
    this.name = "UnknownProductError";
  }
}

// Checked by code, not instanceof, so it survives module mocks and duplicate module instances.
export function isUnknownProductError(error: unknown): error is UnknownProductError {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNKNOWN_PRODUCT;
}

const PUBLIC_FAILURE = /^Coinbase public request failed \((\d{3})\): ([\s\S]*)$/;

/**
 * True when a public market fetch failed because the product does not exist: a 404, or a 400 whose body
 * is about the product id. Timeouts, 5xx and network errors are outages and return false.
 */
export function isProductNotFound(error: unknown): boolean {
  const match = PUBLIC_FAILURE.exec(errorMessage(error, ""));
  if (!match) return false;
  const status = Number(match[1]);
  return status === 404 || (status === 400 && /product/i.test(match[2] ?? ""));
}
