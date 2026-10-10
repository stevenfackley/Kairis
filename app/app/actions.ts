"use server";

import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits, setTradingPaused } from "@/lib/server/repos/limits";
import { requireUser } from "@/lib/server/session";

/**
 * Global kill switch. The form posts the state it wants (`paused=true|false`), not "flip it", so a
 * double-submitted Pause stays paused instead of resuming. Not gated on onboarding: anyone signed
 * in can always stop trading.
 */
export async function togglePauseAction(formData: FormData): Promise<void> {
  const user = await requireUser("/app");
  const current = await getLimits(user.id);
  const requested = formData.get("paused");
  const paused = requested === "true" ? true : requested === "false" ? false : !current.tradingPaused;
  if (paused !== current.tradingPaused) {
    await setTradingPaused(user.id, paused);
    await appendAudit(
      user.id,
      "limits",
      paused ? "paused" : "resumed",
      paused ? "Kill switch on: new paper and live orders are halted." : "Kill switch off: trading resumed."
    );
  }
  revalidatePath("/app", "layout");
}
