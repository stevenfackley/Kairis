export const WATCHLIST = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
export const STRATEGY = {
  granularity: "ONE_HOUR" as const,
  candleSeconds: 3600,
  candleLimit: 120,
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  rsiMin: 45,
  rsiMax: 70,
  rsiOverbought: 75,
  crossLookback: 3,
  maxSpreadPct: 0.5,
  maxAtrPct: 6,
  riskBudgetFraction: 0.25,
  maxTickerAgeMs: 5 * 60 * 1000,
  maxCandleAgeMs: 3 * 60 * 60 * 1000,
  // Stored signals older than this are re-evaluated on Signals or dashboard load, and shown as stale.
  signalRefreshAfterMs: 15 * 60 * 1000
} as const;
/**
 * Simulated taker fee on every paper fill (Coinbase Advanced's entry-tier taker rate). As on Coinbase, a
 * buy's dollar size includes its fee (the fee goes into the cost basis) and a sell's fee comes out of the
 * proceeds, so a flat round trip loses ~1.19 %, as it would live.
 */
export const PAPER_TAKER_FEE_RATE = 0.006;
/** A base size smaller than this is floating-point dust: the position counts as flat everywhere. */
export const DUST_BASE_SIZE = 1e-9;
export const DEFAULT_LIMITS = { maxPositionUsd: 1500, dailyLossCapUsd: 300, maxTradesPerDay: 6, cooldownMinutes: 20, lossStreakTrigger: 2 } as const;
