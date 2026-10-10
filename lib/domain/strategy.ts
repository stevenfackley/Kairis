export const WATCHLIST = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
export const STRATEGY = {
  granularity: "ONE_HOUR" as const,
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
  maxCandleAgeMs: 3 * 60 * 60 * 1000
} as const;
export const DEFAULT_LIMITS = { maxPositionUsd: 1500, dailyLossCapUsd: 300, maxTradesPerDay: 6, cooldownMinutes: 20, lossStreakTrigger: 2 } as const;
