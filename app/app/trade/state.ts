import type { OrderPreview } from "@/lib/exchange/types";
import type { AssistedOrder, RiskDecision } from "@/lib/types";

/** Mirrors PREVIEW_TTL_MS in lib/server/services/assisted.ts, which the client cannot import. */
export const PREVIEW_TTL_SECONDS = 120;

export type PreviewState =
  | { step: "idle" }
  | { step: "error"; error: string }
  | { step: "previewed"; order: AssistedOrder; decision: RiskDecision; preview: OrderPreview }
  | { step: "blocked"; order: AssistedOrder; decision: RiskDecision };

export type SubmitState = { step: "idle" } | { step: "error"; error: string } | { step: "result"; order: AssistedOrder };

export const INITIAL_PREVIEW: PreviewState = { step: "idle" };
export const INITIAL_SUBMIT: SubmitState = { step: "idle" };

/**
 * 1 preview, 2 confirm, 3 result. A submit that errored (a missing confirmation, a claim freed by a
 * failure before the exchange) leaves the order previewed, so the confirm step stays up for a retry.
 */
export function ticketStep(preview: PreviewState, submit: SubmitState): 1 | 2 | 3 {
  if (submit.step === "result") return 3;
  return preview.step === "previewed" || preview.step === "blocked" ? 2 : 1;
}

/** The newest known version of a submitted order: the page's list catches up after Reconcile. */
export function freshestOrder(order: AssistedOrder, recent: readonly AssistedOrder[]): AssistedOrder {
  const row = recent.find((o) => o.id === order.id);
  return row && Date.parse(row.updatedAt) > Date.parse(order.updatedAt) ? row : order;
}
