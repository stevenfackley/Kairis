import { parseOrderForm } from "@/lib/domain/order-form";
import { WATCHLIST } from "@/lib/domain/strategy";
import type { OrderIntent } from "@/lib/types";

// The assisted ticket posts the paper ticket's fields and is parsed by the same rules
// (lib/domain/order-form.ts); this only reshapes the result for previewAssisted. It has no note field.

/** closePosition: sell the whole recorded position by coin amount; quoteUsd is then worked out by the server. */
export type AssistedIntent = Omit<OrderIntent, "mode"> & { closePosition: boolean };
export type AssistedFormResult = { ok: true; intent: AssistedIntent } | { ok: false; error: string };

export function parseAssistedForm(form: FormData): AssistedFormResult {
  const parsed = parseOrderForm(form, WATCHLIST);
  if (!parsed.ok) {
    return parsed;
  }
  const { productId, side, quoteUsd, signalId, sellAll } = parsed.intent;
  return { ok: true, intent: { productId, side, quoteUsd, signalId, closePosition: sellAll === true } };
}
