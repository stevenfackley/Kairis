import type { OrderIntent, RiskCheck, RiskContext, RiskDecision } from "@/lib/types";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function evaluateRisk(ctx: RiskContext, intent: OrderIntent): RiskDecision {
  const checks: RiskCheck[] = [];
  const halt: string[] = [];
  const block: string[] = [];
  const add = (code: string, passed: boolean, detail: string, severity: "halt" | "block") => {
    checks.push({ code, passed, detail });
    if (!passed) (severity === "halt" ? halt : block).push(detail);
  };

  add("global-pause", !ctx.limits.tradingPaused, ctx.limits.tradingPaused ? "Trading is paused by the global kill switch." : "Global pause is off.", "halt");
  add("fresh-data", ctx.dataAgeMs <= ctx.maxDataAgeMs, ctx.dataAgeMs <= ctx.maxDataAgeMs ? `Market data is ${Math.round(ctx.dataAgeMs / 1000)} s old.` : `Market data is ${Math.round(ctx.dataAgeMs / 60000)} min old; new actions are halted until it refreshes.`, "halt");
  add("provider-health", !ctx.providerDegraded, ctx.providerDegraded ? "Exchange provider is degraded; execution is halted." : "Exchange provider is healthy.", "halt");

  const valid = Number.isFinite(intent.quoteUsd) && intent.quoteUsd > 0;
  add("valid-size", valid, valid ? `Order size ${usd(intent.quoteUsd)}.` : "Order size must be a positive dollar amount.", "block");

  const held = ctx.positions[intent.productId];
  const heldNotional = held ? held.baseSize * ctx.referencePrice : 0;
  if (intent.side === "BUY") {
    const after = heldNotional + intent.quoteUsd;
    add("max-position", intent.quoteUsd <= ctx.limits.maxPositionUsd && after <= ctx.limits.maxPositionUsd,
      after <= ctx.limits.maxPositionUsd ? `Position after fill ${usd(after)} is within the ${usd(ctx.limits.maxPositionUsd)} max position.` : `Position after fill ${usd(after)} would exceed the ${usd(ctx.limits.maxPositionUsd)} max position.`, "block");
    const cap = ctx.limits.perSymbolMaxUsd[intent.productId];
    if (cap !== undefined) add("per-symbol-cap", after <= cap, after <= cap ? `Within the ${intent.productId} cap of ${usd(cap)}.` : `Position after fill ${usd(after)} exceeds the ${intent.productId} cap of ${usd(cap)}.`, "block");
  } else {
    const ok = heldNotional > 0 && intent.quoteUsd <= heldNotional * 1.0001;
    add("position-available", ok, heldNotional > 0 ? (ok ? `Selling ${usd(intent.quoteUsd)} of a ${usd(heldNotional)} position.` : `Sell ${usd(intent.quoteUsd)} exceeds the ${usd(heldNotional)} held.`) : `There is no position in ${intent.productId} to sell.`, "block");
  }

  add("trades-per-day", ctx.today.tradesCount < ctx.limits.maxTradesPerDay, ctx.today.tradesCount < ctx.limits.maxTradesPerDay ? `${ctx.today.tradesCount} of ${ctx.limits.maxTradesPerDay} trades used today.` : `Daily trade limit of ${ctx.limits.maxTradesPerDay} reached.`, "block");
  const lossOk = ctx.today.realizedPnlUsd > -ctx.limits.dailyLossCapUsd;
  add("daily-loss-cap", lossOk, lossOk ? `Realized today ${usd(ctx.today.realizedPnlUsd)} against a ${usd(ctx.limits.dailyLossCapUsd)} loss cap.` : `Daily loss cap of ${usd(ctx.limits.dailyLossCapUsd)} reached (realized ${usd(ctx.today.realizedPnlUsd)}).`, "block");

  let inCooldown = false;
  if (ctx.today.consecutiveLosses >= ctx.limits.lossStreakTrigger && ctx.today.lastLossAt) {
    const until = new Date(ctx.today.lastLossAt).getTime() + ctx.limits.cooldownMinutes * 60000;
    inCooldown = ctx.now.getTime() < until;
  }
  add("cooldown", !inCooldown, inCooldown ? `In cooldown after ${ctx.today.consecutiveLosses} consecutive losses; wait ${ctx.limits.cooldownMinutes} min from the last loss.` : "No active cooldown.", "block");

  const outcome = halt.length > 0 ? "halted" : block.length > 0 ? "blocked" : "approved";
  return { outcome, checks, reasons: [...halt, ...block], evaluatedAt: ctx.now.toISOString() };
}
