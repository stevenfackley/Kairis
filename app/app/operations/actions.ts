"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reconcileAssisted } from "@/lib/server/services/assisted";
import { runAutoCycle } from "@/lib/server/services/auto";
import { requireOwner } from "@/lib/server/session";

export async function reconcileAllAction(): Promise<void> {
  const user = await requireOwner("/app/operations");
  let target: string;
  try {
    const { checked, updated } = await reconcileAssisted(user.id);
    target = `/app/operations?reconciled=${checked},${updated}`;
  } catch (e) {
    target = `/app/operations?error=${encodeURIComponent(e instanceof Error ? e.message : "Reconcile failed.")}`;
  }
  revalidatePath("/app/operations");
  redirect(target);
}

export async function runAutoCycleAction(): Promise<void> {
  const user = await requireOwner("/app/operations");
  let target: string;
  try {
    const summary = await runAutoCycle(user.id, { isOwner: user.isOwner });
    target = `/app/operations?auto=${encodeURIComponent(JSON.stringify(summary))}`;
  } catch (e) {
    target = `/app/operations?error=${encodeURIComponent(e instanceof Error ? e.message : "Auto cycle failed.")}`;
  }
  revalidatePath("/app/operations");
  redirect(target);
}
