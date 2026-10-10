import { WATCHLIST } from "@/lib/domain/strategy";
import type { OrderIntent } from "@/lib/types";

// Local stand-in for lib/domain/order-form.ts (the paper ticket's parser, built on another branch).
// Same rules: a watchlist product or a custom XXX-USD product, BUY or SELL, and a USD quote above 0,
// at most 1,000,000, with no more than 2 decimals.

export type AssistedIntent = Omit<OrderIntent, "mode">;
export type AssistedFormResult = { ok: true; intent: AssistedIntent } | { ok: false; error: string };

export const CUSTOM_PRODUCT = "custom";
const PRODUCT_RE = /^[A-Z0-9]{2,10}-USD$/;
const QUOTE_RE = /^\d+(\.\d{1,2})?$/;
const MAX_QUOTE_USD = 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function normalizeProduct(raw: string): string | null {
  const product = raw.trim().toUpperCase();
  return PRODUCT_RE.test(product) ? product : null;
}

export function isWatchlistProduct(product: string): boolean {
  return (WATCHLIST as readonly string[]).includes(product);
}

export function parseAssistedForm(form: FormData): AssistedFormResult {
  const selected = text(form, "productId");
  const raw = selected === CUSTOM_PRODUCT ? text(form, "customProduct") : selected;
  if (!raw) {
    return { ok: false, error: selected === CUSTOM_PRODUCT ? "Enter a custom product such as SOL-USD." : "Choose a product." };
  }
  const productId = normalizeProduct(raw);
  if (!productId) {
    return { ok: false, error: `"${raw}" is not a product such as SOL-USD.` };
  }

  const side = text(form, "side");
  if (side !== "BUY" && side !== "SELL") {
    return { ok: false, error: "Choose Buy or Sell." };
  }

  const quoteText = text(form, "quoteUsd");
  if (!quoteText) {
    return { ok: false, error: "Enter an order size in USD." };
  }
  if (!QUOTE_RE.test(quoteText)) {
    return { ok: false, error: "Order size must be a dollar amount with at most 2 decimals, such as 50 or 49.99." };
  }
  const quoteUsd = Number(quoteText);
  if (!(quoteUsd > 0)) {
    return { ok: false, error: "Order size must be greater than $0." };
  }
  if (quoteUsd > MAX_QUOTE_USD) {
    return { ok: false, error: "Order size must be at most $1,000,000." };
  }

  const signal = text(form, "signalId");
  return { ok: true, intent: { productId, side, quoteUsd, signalId: isUuid(signal) ? signal : null } };
}
