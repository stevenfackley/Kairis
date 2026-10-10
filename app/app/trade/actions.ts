"use server";

import { revalidatePath } from "next/cache";
import { isUuid, parseAssistedForm } from "@/app/app/trade/order-form";
import type { PreviewState, SubmitState } from "@/app/app/trade/state";
import { previewAssisted, reconcileAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { errorMessage } from "@/lib/server/services/shared";
import { requireOnboarded } from "@/lib/server/session";

function revalidateTradeViews(): void {
  revalidatePath("/app/trade");
  revalidatePath("/app");
}

/** Step 1: risk checks, then (when approved) an exchange preview. Both outcomes are recorded as an order row. */
export async function previewAssistedAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const user = await requireOnboarded("/app/trade");
  const parsed = parseAssistedForm(formData);
  if (!parsed.ok) {
    return { step: "error", error: parsed.error };
  }
  try {
    const { decision, order, preview } = await previewAssisted(user.id, parsed.intent);
    revalidateTradeViews();
    if (order.status === "previewed" && preview) {
      return { step: "previewed", order, decision, preview };
    }
    return { step: "blocked", order, decision };
  } catch (error) {
    revalidateTradeViews();
    return { step: "error", error: errorMessage(error, "The exchange preview failed. Try again.") };
  }
}

/** Step 2: submit a previewed order. The service re-checks limits, expiry and the live-trading policy. */
export async function submitAssistedAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const user = await requireOnboarded("/app/trade");
  const orderId = formData.get("orderId");
  if (typeof orderId !== "string" || !isUuid(orderId)) {
    return { step: "error", error: "There is no previewed order to submit. Preview the order again." };
  }
  if (formData.get("confirm") !== "yes") {
    return { step: "error", error: "Tick the confirmation that you reviewed the risk checks and the exchange preview." };
  }
  try {
    const order = await submitAssisted(user.id, orderId);
    revalidateTradeViews();
    return { step: "result", order };
  } catch (error) {
    revalidateTradeViews();
    return { step: "error", error: errorMessage(error, "The submit failed. Check the order in Recent assisted orders.") };
  }
}

export async function reconcileAction(): Promise<void> {
  const user = await requireOnboarded("/app/trade");
  await reconcileAssisted(user.id);
  revalidateTradeViews();
}
