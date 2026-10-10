import { ema } from "@/lib/domain/indicators";
import { isFlat } from "@/lib/domain/paper";
import { completedCandles, suggestedQuoteUsd } from "@/lib/domain/signals";
import { STRATEGY } from "@/lib/domain/strategy";
import { env } from "@/lib/env";
import { appendAudit } from "@/lib/server/repos/audit";
import { getLimits } from "@/lib/server/repos/limits";
import { previewAssisted, settleAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { getMarketSnapshot } from "@/lib/server/services/market";
import { buildRiskContext } from "@/lib/server/services/risk";
import { errorMessage } from "@/lib/server/services/shared";
import { refreshSignals } from "@/lib/server/services/signals";
import type { AssistedOrder } from "@/lib/types";

export type AutoCycleSummary = { evaluated: number; previewed: number; submitted: number; exited: number; skipped: string[] };

/**
 * Submits a previewed order and, as the trade page does, records the fill straight away when Coinbase
 * already reports it. Sent means it reached the exchange: still `submitted`, or already `filled`.
 */
async function submitAndSettle(userId: string, orderId: string): Promise<{ order: AssistedOrder; sent: boolean }> {
  const order = await settleAssisted(userId, await submitAssisted(userId, orderId));
  return { order, sent: order.status === "submitted" || order.status === "filled" };
}

// Per-process guard: one cycle per account at a time, so a double click cannot stack orders.
const running = new Set<string>();

/**
 * One auto cycle, run only when the owner presses the button on the Operations page (there is no
 * scheduler). It opens long positions on fresh signals and closes a held position in full when its
 * trend turns down (fast EMA below slow EMA on completed candles). Every order still goes through the
 * same preview -> risk re-check -> submit path as a human-driven assisted order, and a failure on one
 * product is recorded as a skip without stopping the others.
 */
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
  if (running.has(userId)) {
    throw new Error("An auto cycle is already running for this account; wait for it to finish.");
  }
  running.add(userId);
  try {
    // Without a stored key the exchange client falls back to the mock provider; auto mode must not
    // record mock fills as live positions.
    if (!(await getConnectionStatus(userId))) {
      throw new Error("Auto mode needs a connected Coinbase key.");
    }
    return await cycle(userId);
  } finally {
    running.delete(userId);
  }
}

async function cycle(userId: string): Promise<AutoCycleSummary> {
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
      const submitted = await submitAndSettle(userId, order.id);
      if (submitted.sent) {
        summary.submitted += 1;
      } else {
        summary.skipped.push(`${signal.productId}: ${submitted.order.detail}`);
      }
    } catch (error) {
      summary.skipped.push(`${signal.productId}: ${errorMessage(error)}`);
    }
  }

  await exitDowntrends(userId, summary, signals[0]?.productId ?? "BTC-USD");

  await appendAudit(
    userId,
    "auto",
    "cycle",
    `Evaluated ${summary.evaluated}, previewed ${summary.previewed}, submitted ${summary.submitted}, exited ${summary.exited}.` +
      (summary.skipped.length > 0 ? ` Skipped: ${summary.skipped.join("; ")}` : "")
  );
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
    if (isFlat(position.baseSize)) {
      continue;
    }
    try {
      const snapshot = await getMarketSnapshot(productId);
      const closes = completedCandles(snapshot.candles, Date.now()).map((c) => c.close);
      const fast = ema(closes, STRATEGY.emaFast);
      const slow = ema(closes, STRATEGY.emaSlow);
      if (fast === null || slow === null) {
        summary.skipped.push(`${productId}: not enough candles to judge the trend for an exit.`);
        continue;
      }
      if (fast >= slow) {
        continue;
      }
      // Sells the exact held coins (base_size), never a dollar figure that could round past the position.
      const { decision, order } = await previewAssisted(userId, { productId, side: "SELL", quoteUsd: 0, closePosition: true });
      if (decision.outcome !== "approved") {
        summary.skipped.push(`${productId}: exit blocked: ${decision.reasons.join(" ")}`);
        continue;
      }
      summary.previewed += 1;
      const submitted = await submitAndSettle(userId, order.id);
      if (submitted.sent) {
        summary.submitted += 1;
        summary.exited += 1;
      } else {
        summary.skipped.push(`${productId}: exit not submitted: ${submitted.order.detail}`);
      }
    } catch (error) {
      summary.skipped.push(`${productId}: exit failed: ${errorMessage(error)}`);
    }
  }
}
