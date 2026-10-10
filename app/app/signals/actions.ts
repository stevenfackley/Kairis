"use server";

import { revalidatePath } from "next/cache";
import { refreshSignals } from "@/lib/server/services/signals";
import { requireOnboarded } from "@/lib/server/session";

/** Re-evaluates the shared watchlist. One product failing is stored as a blocked signal, not thrown. */
export async function refreshSignalsAction(): Promise<void> {
  const user = await requireOnboarded("/app/signals");
  await refreshSignals(user.id);
  revalidatePath("/app/signals");
  // The dashboard shows the latest signals too.
  revalidatePath("/app");
}
