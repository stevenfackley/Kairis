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
