// Coinbase reports order problems as enum codes (PreviewFailureReason, NewOrderFailureReason and
// PreviewWarningMsg in the Advanced Trade OpenAPI spec). These turn the common ones into sentences and
// fall back to a readable form of the code for the rest; the code itself is kept in brackets.

const FAILURE_TEXT: Record<string, string> = {
  INSUFFICIENT_FUND: "Not enough funds in the Coinbase account for this order.",
  INSUFFICIENT_FUNDS: "Not enough funds in the Coinbase account for this order.",
  INSUFFICIENT_LEDGER_BALANCE: "Not enough funds in the Coinbase account for this order.",
  INVALID_LEDGER_BALANCE: "Coinbase could not read the account balance for this order.",
  INVALID_PRODUCT_ID: "Coinbase does not recognise this product.",
  INVALID_SIZE_PRECISION: "The order size has more decimals than Coinbase allows for this product.",
  INVALID_QUOTE_SIZE_PRECISION: "The order size has more decimals than Coinbase allows for this product.",
  INVALID_BASE_SIZE_TOO_SMALL: "The order is below the minimum size Coinbase accepts for this product.",
  INVALID_QUOTE_SIZE_TOO_SMALL: "The order is below the minimum size Coinbase accepts for this product.",
  INVALID_BASE_SIZE_TOO_LARGE: "The order is above the maximum size Coinbase accepts for this product.",
  INVALID_QUOTE_SIZE_TOO_LARGE: "The order is above the maximum size Coinbase accepts for this product.",
  NON_NUMERIC_ORDER_SIZE: "The order size is not a number.",
  INVALID_ORDER_CONFIG: "Coinbase rejected the order configuration.",
  UNSUPPORTED_ORDER_CONFIGURATION: "Coinbase rejected the order configuration.",
  TRADING_DISABLED: "Trading in this product is disabled on Coinbase right now.",
  PRODUCT_TRADING_HALTED: "Trading in this product is halted on Coinbase right now.",
  UNTRADABLE_PRODUCT: "This product cannot be traded on Coinbase right now.",
  ORDER_ENTRY_DISABLED: "Coinbase is not accepting new orders right now.",
  NOT_ALLOWED_BY_MARKET_STATE: "Coinbase does not accept this order type in the product's current market state.",
  INVALID_NO_LIQUIDITY: "There is not enough liquidity on Coinbase to fill this market order.",
  MISSING_PRODUCT_PRICE_BOOK: "Coinbase has no current price book for this product.",
  MISSING_MARKET_TRADE_DATA: "Coinbase has no recent trade data for this product.",
  GEOFENCING_RESTRICTION: "Coinbase does not allow this product for the account's region.",
  COMPLIANCE_PURCHASE_LIMIT_EXCEEDED: "The order exceeds a purchase limit on the Coinbase account.",
  MAX_DAILY_VOLUME_NOTIONAL_BREACHED: "The order exceeds the daily volume limit on the Coinbase account.",
  BREACHED_RISK_LIMIT: "The order breaches a Coinbase risk limit on the account.",
  INELIGIBLE_PAIR: "This pair is not eligible for trading on the account.",
  DUPLICATE_CLIENT_ORDER_ID: "Coinbase already has an order with this client order id.",
  COMMANDER_REJECTED_NEW_ORDER: "Coinbase's matching engine rejected the order.",
  INVALID_REQUEST: "Coinbase rejected the request as invalid."
};

const WARNING_TEXT: Record<string, string> = {
  BIG_ORDER: "Large order for this market: expect the fill price to move against you.",
  SMALL_ORDER: "Small order: fees are a large share of it.",
  DURATION_EXTENDED_BY_MARKET_CLOSE: "The order duration was extended by the market close.",
  OPEN_ORDERS_EXCEED_COMPLIANCE_PURCHASE_LIMIT_MAY_CANCEL: "Open orders exceed a purchase limit; Coinbase may cancel some."
};

function readable(code: string): string {
  const words = code.toLowerCase().replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : "Unspecified reason.";
}

function describe(table: Record<string, string>, raw: string, prefix: RegExp): string {
  const code = raw.trim();
  const key = code.replace(prefix, "");
  return `${table[key] ?? readable(key)} (${code})`;
}

/** An `errs` entry of an order preview: why the order would fail if submitted. */
export function describePreviewFailure(code: string): string {
  if (code === "UNKNOWN_PREVIEW_FAILURE_REASON") return `Coinbase says the order would fail but gives no reason (${code})`;
  return describe(FAILURE_TEXT, code, /^PREVIEW_/);
}

/** new_order_failure_reason (or a deprecated preview_failure_reason) of a rejected create-order call. */
export function describeOrderFailure(code: string): string {
  if (code === "UNKNOWN_FAILURE_REASON" || code === "UNKNOWN_PREVIEW_FAILURE_REASON") return "";
  return describe(FAILURE_TEXT, code, /^PREVIEW_/);
}

/** A `warning` entry of an order preview, or null for the enum's UNKNOWN default. */
export function describePreviewWarning(code: string): string | null {
  if (code === "UNKNOWN" || code.trim() === "") return null;
  return describe(WARNING_TEXT, code, /^$/);
}
