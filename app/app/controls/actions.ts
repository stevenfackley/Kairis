"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseLimitsForm, parsePreferredMode } from "@/lib/domain/limits-form";
import { usd } from "@/lib/format";
import { appendAudit } from "@/lib/server/repos/audit";
import { saveLimits } from "@/lib/server/repos/limits";
import { getOnboarding, saveOnboarding } from "@/lib/server/repos/onboarding";
import { requireOnboarded } from "@/lib/server/session";
import type { TradingLimits } from "@/lib/types";

export type LimitsFormState = { error: string | null; saved: boolean };

function summary(limits: TradingLimits): string {
  const caps =
    Object.entries(limits.perSymbolMaxUsd)
      .map(([productId, cap]) => `${productId} ${usd(cap)}`)
      .join(", ") || "none";
  return (
    `Max position ${usd(limits.maxPositionUsd)}, daily loss cap ${usd(limits.dailyLossCapUsd)}, ` +
    `${limits.maxTradesPerDay} trades/day, ${limits.cooldownMinutes} min cooldown after ${limits.lossStreakTrigger} losses in a row, ` +
    `per-symbol caps: ${caps}, paused: ${limits.tradingPaused ? "yes" : "no"}.`
  );
}

// The kill switch itself is togglePauseAction in app/app/actions.ts, shared with the dashboard. Saving
// limits only changes the pause when the user toggled the box on this form (see parseLimitsForm).
export async function saveLimitsAction(_prev: LimitsFormState, formData: FormData): Promise<LimitsFormState> {
  const user = await requireOnboarded("/app/controls");
  const parsed = parseLimitsForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error, saved: false };
  }
  const saved = await saveLimits({ userId: user.id, ...parsed.limits });
  await appendAudit(user.id, "limits", "saved", summary(saved));
  revalidatePath("/app", "layout");
  return { error: null, saved: true };
}

/** Changes the preferred execution mode without revisiting onboarding; acknowledgment and exchange state stay as they are. */
export async function savePreferredModeAction(formData: FormData): Promise<void> {
  const user = await requireOnboarded("/app/controls");
  const parsed = parsePreferredMode(formData);
  if (!parsed.ok) {
    redirect(`/app/controls?modeError=${encodeURIComponent(parsed.error)}`);
  }
  const current = await getOnboarding(user.id);
  if (current.preferredMode !== parsed.mode) {
    await saveOnboarding({
      userId: user.id,
      preferredMode: parsed.mode,
      riskAcknowledged: current.riskAcknowledged,
      exchangeConnected: current.exchangeConnected,
      completedAt: current.completedAt
    });
    await appendAudit(user.id, "onboarding", "preferred-mode", `Preferred mode changed from ${current.preferredMode} to ${parsed.mode}.`);
  }
  revalidatePath("/app", "layout");
  redirect("/app/controls?mode=saved");
}
