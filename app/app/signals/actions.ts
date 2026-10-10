"use server";

import { revalidatePath } from "next/cache";
import { refreshSignalsOnce } from "@/lib/server/services/signals";
import { requireOnboarded } from "@/lib/server/session";

/**
 * Re-evaluates the shared watchlist. One product failing is stored as a blocked signal, not thrown. Joins
 * an automatic refresh already in flight instead of writing a second set of rows.
 */
export async function refreshSignalsAction(): Promise<void> {
  const user = await requireOnboarded("/app/signals");
  await refreshSignalsOnce(user.id);
  revalidatePath("/app/signals");
  // The dashboard shows the latest signals too.
  revalidatePath("/app");
}
