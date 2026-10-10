"use server";

import { revalidatePath } from "next/cache";
import type { PaperTicketState } from "@/app/app/paper/state";
import { parseOrderForm } from "@/lib/domain/order-form";
import { WATCHLIST } from "@/lib/domain/strategy";
import { placePaperOrder } from "@/lib/server/services/paper";
import { errorMessage } from "@/lib/server/services/shared";
import { requireOnboarded } from "@/lib/server/session";

/** Risk-checks and simulates one paper order. A blocked order is still recorded, with its reasons. */
export async function placePaperOrderAction(_prev: PaperTicketState, formData: FormData): Promise<PaperTicketState> {
  // Outside the try: its redirect must propagate, not be reported as a form error.
  const user = await requireOnboarded("/app/paper");
  const parsed = parseOrderForm(formData, WATCHLIST);
  if (!parsed.ok) {
    return { error: parsed.error, result: null };
  }
  try {
    const { productId, side, quoteUsd, note, signalId } = parsed.intent;
    const { trade, decision } = await placePaperOrder(user.id, { productId, side, quoteUsd, note, signalId });
    revalidatePath("/app/paper");
    revalidatePath("/app");
    return { error: null, result: { trade, decision } };
  } catch (error) {
    console.error("paper order failed", error);
    return { error: `The paper order could not be placed: ${errorMessage(error, "unknown error.")}`, result: null };
  }
}
