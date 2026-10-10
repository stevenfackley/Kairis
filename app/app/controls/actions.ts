"use server";

import { revalidatePath } from "next/cache";
import { parseLimitsForm } from "@/lib/domain/limits-form";
import { appendAudit } from "@/lib/server/repos/audit";
import { saveLimits } from "@/lib/server/repos/limits";
import { requireOnboarded } from "@/lib/server/session";
import type { TradingLimits } from "@/lib/types";

export type LimitsFormState = { error: string | null; saved: boolean };

const money = (n: number) => `$${n.toFixed(2)}`;

function summary(limits: TradingLimits): string {
  const caps =
    Object.entries(limits.perSymbolMaxUsd)
      .map(([productId, cap]) => `${productId} ${money(cap)}`)
      .join(", ") || "none";
  return (
    `Max position ${money(limits.maxPositionUsd)}, daily loss cap ${money(limits.dailyLossCapUsd)}, ` +
    `${limits.maxTradesPerDay} trades/day, ${limits.cooldownMinutes} min cooldown after ${limits.lossStreakTrigger} losses in a row, ` +
    `per-symbol caps: ${caps}, paused: ${limits.tradingPaused ? "yes" : "no"}.`
  );
}

// The kill switch itself is togglePauseAction in app/app/actions.ts, shared with the dashboard.
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
