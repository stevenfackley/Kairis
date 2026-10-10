import type { Side } from "@/lib/types";

export const MAX_TICKET_USD = 1_000_000;
export const MAX_NOTE_LENGTH = 280;
/** The select value that switches the ticket to a typed product id. */
export const CUSTOM_PRODUCT = "custom";

const PRODUCT_ID = /^[A-Z0-9]{2,10}-USD$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Plain decimal only: no exponent, hex, Infinity or thousands separators.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export type OrderFormIntent = { productId: string; side: Side; quoteUsd: number; note: string; signalId: string | null };
export type OrderFormResult = { ok: true; intent: OrderFormIntent } | { ok: false; error: string };

/** A form field as trimmed text; files and missing fields read as "". */
function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Upper-cased Coinbase USD spot id (BTC-USD), or null when it does not look like one. */
export function normalizeProductId(value: string | null | undefined): string | null {
  const id = (value ?? "").trim().toUpperCase();
  return PRODUCT_ID.test(id) ? id : null;
}

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

function decimals(raw: string): number {
  const fraction = raw.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

/** Parses the paper (and assisted) order ticket. Errors are plain sentences shown as-is. */
export function parseOrderForm(formData: FormData, watchlist: readonly string[]): OrderFormResult {
  const choice = text(formData, "product");
  let productId: string;
  if (choice === CUSTOM_PRODUCT) {
    const custom = text(formData, "customProduct");
    if (!custom) return { ok: false, error: "Type the product you want, such as AVAX-USD." };
    const normalized = normalizeProductId(custom);
    if (!normalized) {
      return { ok: false, error: `"${custom}" is not a Coinbase USD pair. Use the form COIN-USD, such as AVAX-USD.` };
    }
    productId = normalized;
  } else if (!choice) {
    return { ok: false, error: "Choose a product." };
  } else if (watchlist.includes(choice)) {
    productId = choice;
  } else {
    return { ok: false, error: "That product is not on the watchlist. Choose Custom to type another one." };
  }

  const sideText = text(formData, "side").toUpperCase();
  if (sideText !== "BUY" && sideText !== "SELL") return { ok: false, error: "Choose buy or sell." };
  const side: Side = sideText;

  const raw = text(formData, "quoteUsd");
  if (!raw) return { ok: false, error: "Enter an order size in US dollars." };
  const quoteUsd = Number(raw);
  if (!DECIMAL.test(raw) || !Number.isFinite(quoteUsd)) {
    return { ok: false, error: "Order size must be a plain dollar amount, such as 100 or 25.50." };
  }
  if (quoteUsd <= 0) return { ok: false, error: "Order size must be more than $0." };
  if (decimals(raw) > 2) return { ok: false, error: "Order size can have at most two decimal places (whole cents)." };
  if (quoteUsd > MAX_TICKET_USD) return { ok: false, error: "Order size is capped at $1,000,000 per ticket." };

  const note = text(formData, "note");
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer (it has ${note.length}).` };
  }

  // signal_id is a uuid column: a tampered or truncated id is dropped rather than failing the order.
  const signalText = text(formData, "signalId");
  return { ok: true, intent: { productId, side, quoteUsd, note, signalId: isUuid(signalText) ? signalText : null } };
}
