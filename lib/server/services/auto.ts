import { suggestedQuoteUsd } from "@/lib/domain/signals";
import { env } from "@/lib/env";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits } from "@/lib/server/repos/limits";
import { previewAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { errorMessage } from "@/lib/server/services/shared";
import { refreshSignals } from "@/lib/server/services/signals";

export type AutoCycleSummary = { evaluated: number; previewed: number; submitted: number; skipped: string[] };

// Entry-only by design: auto mode opens long positions on fresh signals and never sells. Every order
// still goes through the same preview -> risk re-check -> submit path as a human-driven assisted order.
export async function runAutoCycle(userId: string, caller: { isOwner: boolean }): Promise<AutoCycleSummary> {
  if (!caller.isOwner) {
    throw new Error("Auto mode is owner-only.");
  }
  if (!env.autoModeEnabled) {
    throw new Error("Auto mode is disabled (ENABLE_AUTO_MODE=false).");
  }
  if (!env.liveAssistedTradingEnabled) {
    throw new Error("Auto mode needs live assisted trading enabled.");
  }

  const limits = await getLimits(userId);
  const signals = await refreshSignals(userId);
  const summary: AutoCycleSummary = { evaluated: signals.length, previewed: 0, submitted: 0, skipped: [] };

  for (const signal of signals) {
    if (signal.action !== "long") {
      continue;
    }
    const quoteUsd = suggestedQuoteUsd(limits, signal.atrPct);
    if (quoteUsd <= 0) {
      summary.skipped.push(`${signal.productId}: no ATR-based size available.`);
      continue;
    }
    try {
      const { decision, order } = await previewAssisted(userId, { productId: signal.productId, side: "BUY", quoteUsd, signalId: signal.id });
      if (decision.outcome !== "approved") {
        summary.skipped.push(`${signal.productId}: ${decision.reasons.join(" ")}`);
        continue;
      }
      summary.previewed += 1;
      const submitted = await submitAssisted(userId, order.id);
      if (submitted.status === "submitted") {
        summary.submitted += 1;
      } else {
        summary.skipped.push(`${signal.productId}: ${submitted.detail}`);
      }
    } catch (error) {
      summary.skipped.push(`${signal.productId}: ${errorMessage(error)}`);
    }
  }

  await appendAudit(userId, "auto", "cycle", JSON.stringify(summary));
  return summary;
}
