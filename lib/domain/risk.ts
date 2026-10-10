import { isFlat } from "@/lib/domain/paper";
import { usd } from "@/lib/format";
import type { OrderIntent, RiskCheck, RiskContext, RiskDecision } from "@/lib/types";

const cents = (n: number) => Math.round(n * 100);
/** a <= b once both are rounded to whole cents: float noise never decides a limit. */
const withinCents = (a: number, b: number) => cents(a) <= cents(b);
const hhmmUtc = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * Every limit is checked on every order, paper and live. Halts (pause, stale data, provider or price
 * trouble) stop everything until the condition clears; blocks are limits this order would break.
 * Money limits compare in whole cents. Position size is measured at the current market price.
 * Day-scoped limits use the UTC day and realized P&L only (see dayStats).
 */
export function evaluateRisk(ctx: RiskContext, intent: OrderIntent): RiskDecision {
  const checks: RiskCheck[] = [];
  const halt: string[] = [];
  const block: string[] = [];
  const add = (code: string, passed: boolean, detail: string, severity: "halt" | "block") => {
    checks.push({ code, passed, detail });
    if (!passed) (severity === "halt" ? halt : block).push(detail);
  };

  add("global-pause", !ctx.limits.tradingPaused, ctx.limits.tradingPaused ? "Trading is paused by the global kill switch." : "Global pause is off.", "halt");
  const fresh = ctx.dataAgeMs <= ctx.maxDataAgeMs;
  add("fresh-data", fresh, fresh ? `Market data is ${Math.round(Math.max(0, ctx.dataAgeMs) / 1000)} s old.` : `Market data is ${Math.round(ctx.dataAgeMs / 60000)} min old; new actions are halted until it refreshes.`, "halt");

  // An unknown product is the order's problem, not the provider's: it is blocked below instead.
  const unknown = ctx.unknownProduct === true;
  const priceOk = Number.isFinite(ctx.referencePrice) && ctx.referencePrice > 0;
  const healthy = !ctx.providerDegraded && (priceOk || unknown);
  add(
    "provider-health",
    healthy,
    ctx.providerDegraded
      ? "Exchange provider is degraded; execution is halted."
      : healthy
        ? "Exchange provider is healthy."
        : `No usable market price for ${intent.productId}; execution is halted until one arrives.`,
    "halt"
  );
  if (unknown) add("tradable-product", false, `${intent.productId} is not a tradable Coinbase pair.`, "block");

  const valid = Number.isFinite(intent.quoteUsd) && intent.quoteUsd > 0;
  const held = ctx.positions[intent.productId];
  const heldNotional = held && !isFlat(held.baseSize) && priceOk ? held.baseSize * ctx.referencePrice : 0;
  // A sell with nothing held is explained by position-available; a $0 size is just a symptom of that.
  const nothingToSell = intent.side === "SELL" && heldNotional === 0;
  add("valid-size", valid || nothingToSell, valid ? `Order size ${usd(intent.quoteUsd)}.` : nothingToSell ? "No position to size." : "Order size must be a positive dollar amount.", "block");
  if (intent.side === "BUY") {
    const after = heldNotional + intent.quoteUsd;
    const max = ctx.limits.maxPositionUsd;
    const maxOk = withinCents(intent.quoteUsd, max) && withinCents(after, max);
    add("max-position", maxOk, maxOk ? `Position after fill ${usd(after)} is within the ${usd(max)} max position.` : `Position after fill ${usd(after)} would exceed the ${usd(max)} max position.`, "block");
    const cap = ctx.limits.perSymbolMaxUsd[intent.productId];
    if (cap !== undefined) {
      const capOk = withinCents(after, cap);
      add("per-symbol-cap", capOk, capOk ? `Within the ${intent.productId} cap of ${usd(cap)}.` : `Position after fill ${usd(after)} exceeds the ${intent.productId} cap of ${usd(cap)}.`, "block");
    }
  } else {
    // A dollar-sized sell of the whole position may round up by up to a cent; the fill is capped at the held size.
    const ok = heldNotional > 0 && withinCents(intent.quoteUsd, heldNotional * 1.0001);
    add("position-available", ok, heldNotional > 0 ? (ok ? `Selling ${usd(intent.quoteUsd)} of a ${usd(heldNotional)} position.` : `Sell ${usd(intent.quoteUsd)} exceeds the ${usd(heldNotional)} held.`) : `There is no position in ${intent.productId} to sell.`, "block");
  }

  const tradesOk = ctx.today.tradesCount < ctx.limits.maxTradesPerDay;
  add("trades-per-day", tradesOk, tradesOk ? `${ctx.today.tradesCount} of ${ctx.limits.maxTradesPerDay} trades used today (UTC).` : `Daily trade limit of ${ctx.limits.maxTradesPerDay} reached for today (UTC).`, "block");
  const lossOk = cents(ctx.today.realizedPnlUsd) > -cents(ctx.limits.dailyLossCapUsd);
  add("daily-loss-cap", lossOk, lossOk ? `Realized P&L today (UTC) ${usd(ctx.today.realizedPnlUsd)} against a ${usd(ctx.limits.dailyLossCapUsd)} loss cap.` : `Daily loss cap of ${usd(ctx.limits.dailyLossCapUsd)} reached (realized ${usd(ctx.today.realizedPnlUsd)} today, UTC).`, "block");

  let cooldownEnds: number | null = null;
  if (ctx.today.consecutiveLosses >= ctx.limits.lossStreakTrigger && ctx.today.lastLossAt) {
    const until = new Date(ctx.today.lastLossAt).getTime() + ctx.limits.cooldownMinutes * 60000;
    if (ctx.now.getTime() < until) cooldownEnds = until;
  }
  add(
    "cooldown",
    cooldownEnds === null,
    cooldownEnds === null
      ? "No active cooldown."
      : `In cooldown after ${ctx.today.consecutiveLosses} consecutive losses; new orders wait until ${hhmmUtc(cooldownEnds)} UTC (${ctx.limits.cooldownMinutes} min after the last loss).`,
    "block"
  );

  const outcome = halt.length > 0 ? "halted" : block.length > 0 ? "blocked" : "approved";
  return { outcome, checks, reasons: [...halt, ...block], evaluatedAt: ctx.now.toISOString() };
}
