import { atr, ema, rsi } from "@/lib/domain/indicators";
import { STRATEGY } from "@/lib/domain/strategy";
import type { Candle, SignalEvaluation, Ticker } from "@/lib/types";

const round = (n: number, dp: number) => Number(n.toFixed(dp));

export function suggestedQuoteUsd(limits: { dailyLossCapUsd: number; maxPositionUsd: number }, atrPct: number | null): number {
  if (!atrPct || atrPct <= 0) return 0;
  const budget = limits.dailyLossCapUsd * STRATEGY.riskBudgetFraction;
  return round(Math.min(limits.maxPositionUsd, budget / (atrPct / 100)), 2);
}

export function evaluateSignal(productId: string, candles: Candle[], ticker: Ticker, nowMs: number): SignalEvaluation {
  const evaluatedAt = new Date(nowMs).toISOString();
  const dataAgeMs = Math.max(0, nowMs - ticker.tradeTime);
  const spreadPct = ticker.bestBid > 0 ? round(((ticker.bestAsk - ticker.bestBid) / ticker.bestBid) * 100, 4) : null;
  const base = { productId, referencePrice: ticker.price, spreadPct, dataAgeMs, evaluatedAt };
  const blocked = (setup: string, rationale: string[], extra: Partial<SignalEvaluation> = {}): SignalEvaluation => ({
    ...base, action: "blocked", setup, rationale, strength: 0, atrPct: null, rsi: null, ...extra
  });

  if (dataAgeMs > STRATEGY.maxTickerAgeMs) return blocked("Stale data", [`Ticker is ${Math.round(dataAgeMs / 60000)} min old; stale market data fails closed.`]);
  const need = Math.max(STRATEGY.emaSlow + STRATEGY.crossLookback, STRATEGY.rsiPeriod + 1, STRATEGY.atrPeriod);
  if (candles.length < need) return blocked("Insufficient data", [`Only ${candles.length} candles; ${need} needed.`]);
  const last = candles[candles.length - 1]!;
  const candleAgeMs = nowMs - last.start * 1000;
  if (candleAgeMs > STRATEGY.maxCandleAgeMs) return blocked("Stale data", [`Last candle started ${Math.round(candleAgeMs / 3600000)} h ago; stale market data fails closed.`]);

  const closes = candles.map((c) => c.close);
  const atrAbs = atr(candles, STRATEGY.atrPeriod);
  const atrPct = atrAbs ? round((atrAbs / last.close) * 100, 4) : null;
  const rsiNow = rsi(closes, STRATEGY.rsiPeriod);
  const rsiRounded = rsiNow === null ? null : round(rsiNow, 2);

  if (spreadPct !== null && spreadPct > STRATEGY.maxSpreadPct) return blocked("Illiquid book", [`Spread ${spreadPct}% exceeds the ${STRATEGY.maxSpreadPct}% limit.`], { atrPct, rsi: rsiRounded });
  if (atrPct !== null && atrPct > STRATEGY.maxAtrPct) return blocked("Volatility spike", [`ATR ${atrPct}% of price exceeds the ${STRATEGY.maxAtrPct}% limit.`], { atrPct, rsi: rsiRounded });

  // Cross detection over the last `crossLookback` bars.
  const diffs: number[] = [];
  for (let k = STRATEGY.crossLookback; k >= 0; k -= 1) {
    const slice = closes.slice(0, closes.length - k);
    const f = ema(slice, STRATEGY.emaFast);
    const s = ema(slice, STRATEGY.emaSlow);
    diffs.push(f !== null && s !== null ? f - s : 0);
  }
  const crossedUp = diffs[diffs.length - 1]! > 0 && diffs.slice(0, -1).some((d) => d <= 0);
  const aboveSlow = diffs[diffs.length - 1]! > 0;
  const rationale: string[] = [];
  rationale.push(aboveSlow ? "EMA 9 is above EMA 21 (trend up)." : "EMA 9 is below EMA 21 (trend down or flat).");
  if (crossedUp) rationale.push(`EMA 9 crossed above EMA 21 within the last ${STRATEGY.crossLookback} candles.`);
  if (rsiRounded !== null) rationale.push(`RSI 14 is ${rsiRounded}.`);
  if (atrPct !== null) rationale.push(`ATR 14 is ${atrPct}% of price.`);
  if (spreadPct !== null) rationale.push(`Spread is ${spreadPct}%.`);

  const common = { ...base, atrPct, rsi: rsiRounded };
  if (rsiRounded !== null && rsiRounded > STRATEGY.rsiOverbought) return { ...common, action: "observe", setup: "Overbought", rationale: [...rationale, `RSI above ${STRATEGY.rsiOverbought}: wait for a pullback.`], strength: 0 };
  if (crossedUp && rsiRounded !== null && rsiRounded >= STRATEGY.rsiMin && rsiRounded <= STRATEGY.rsiMax) {
    const strength = round(Math.min(1, (rsiRounded - STRATEGY.rsiMin) / (STRATEGY.rsiMax - STRATEGY.rsiMin) * 0.6 + 0.4), 3);
    return { ...common, action: "long", setup: "Trend continuation", rationale, strength };
  }
  if (crossedUp) return { ...common, action: "observe", setup: "Cross outside RSI band", rationale: [...rationale, `RSI outside ${STRATEGY.rsiMin}-${STRATEGY.rsiMax}; cross not confirmed.`], strength: 0 };
  return { ...common, action: "observe", setup: aboveSlow ? "Trend intact, no fresh cross" : "No setup", rationale, strength: 0 };
}
