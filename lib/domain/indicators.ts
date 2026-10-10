import type { Candle } from "@/lib/types";

/** EMA seeded with the SMA of the first `period` values. Null until `period` values exist. */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) value = values[i]! * k + value * (1 - k);
  return value;
}

/** Wilder RSI over closes. Null until `period + 1` closes exist. */
export function rsi(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Simple-average ATR of the last `period` true ranges. Null until `period` candles exist. */
export function atr(candles: Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  const ranges: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const cur = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : cur.close;
    ranges.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose)));
  }
  const tail = ranges.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
