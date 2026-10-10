import { ema } from "@/lib/domain/indicators";
import { suggestedQuoteUsd } from "@/lib/domain/signals";
import { STRATEGY } from "@/lib/domain/strategy";
import { env } from "@/lib/env";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits } from "@/lib/server/repos/limits";
import { previewAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { getMarketSnapshot } from "@/lib/server/services/market";
import { buildRiskContext } from "@/lib/server/services/risk";
import { errorMessage } from "@/lib/server/services/shared";
import { refreshSignals } from "@/lib/server/services/signals";

export type AutoCycleSummary = { evaluated: number; previewed: number; submitted: number; exited: number; skipped: string[] };

// Auto mode opens long positions on fresh signals and closes a held position in full when its trend
// turns down (fast EMA below slow EMA). Every order still goes through the same preview -> risk re-check -> submit path as a human-driven assisted order.
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
  const summary: AutoCycleSummary = { evaluated: signals.length, previewed: 0, submitted: 0, exited: 0, skipped: [] };

  for (const signal of signals) {
    if (signal.action !== "long") {
      continue;
    }
    const quoteUsd = suggestedQuoteUsd(limits, signal.atrPct, signal.productId);
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

  await exitDowntrends(userId, summary, signals[0]?.productId ?? "BTC-USD");

  await appendAudit(userId, "auto", "cycle", JSON.stringify(summary));
  return summary;
}

async function exitDowntrends(userId: string, summary: AutoCycleSummary, contextProductId: string): Promise<void> {
  let positions;
  try {
    positions = (await buildRiskContext(userId, "live", contextProductId)).positions;
  } catch (error) {
    summary.skipped.push(`exits: could not load positions: ${errorMessage(error)}`);
    return;
  }
  for (const [productId, position] of Object.entries(positions)) {
    if (position.baseSize <= 0) {
      continue;
    }
    try {
      const snapshot = await getMarketSnapshot(productId);
      const closes = snapshot.candles.map((c) => c.close);
      const fast = ema(closes, STRATEGY.emaFast);
      const slow = ema(closes, STRATEGY.emaSlow);
      if (fast === null || slow === null) {
        summary.skipped.push(`${productId}: not enough candles to judge the trend for an exit.`);
        continue;
      }
      if (fast >= slow) {
        continue;
      }
      const quoteUsd = Math.round(position.baseSize * snapshot.ticker.price * 100) / 100;
      if (quoteUsd <= 0) {
        summary.skipped.push(`${productId}: exit size rounds to zero.`);
        continue;
      }
      const { decision, order } = await previewAssisted(userId, { productId, side: "SELL", quoteUsd });
      if (decision.outcome !== "approved") {
        summary.skipped.push(`${productId}: exit blocked: ${decision.reasons.join(" ")}`);
        continue;
      }
      summary.previewed += 1;
      const submitted = await submitAssisted(userId, order.id);
      if (submitted.status === "submitted") {
        summary.submitted += 1;
        summary.exited += 1;
      } else {
        summary.skipped.push(`${productId}: exit not submitted: ${submitted.detail}`);
      }
    } catch (error) {
      summary.skipped.push(`${productId}: exit failed: ${errorMessage(error)}`);
    }
  }
}
