import { evaluateSignal, suggestedQuoteUsd } from "@/lib/domain/signals";
import { STRATEGY, WATCHLIST } from "@/lib/domain/strategy";
import { appendAudit } from "@/lib/server/repos/audit";
import { insertSignal, latestSignals } from "@/lib/server/repos/signals";
import { getMarketSnapshot } from "@/lib/server/services/market";
import { errorMessage } from "@/lib/server/services/shared";
import type { SignalEvaluation, SignalRecord, TradingLimits } from "@/lib/types";

/** Signals older than this are re-evaluated automatically when the Signals page or the dashboard loads. */
export const SIGNAL_REFRESH_AFTER_MS = STRATEGY.signalRefreshAfterMs;

function unavailable(productId: string, error: unknown, nowMs: number): SignalEvaluation {
  return {
    productId,
    action: "blocked",
    setup: "Market data unavailable",
    rationale: [errorMessage(error, "Unknown market data error.")],
    strength: 0,
    referencePrice: 0,
    atrPct: null,
    rsi: null,
    spreadPct: null,
    dataAgeMs: 0,
    evaluatedAt: new Date(nowMs).toISOString()
  };
}

async function evaluate(productId: string): Promise<SignalEvaluation> {
  try {
    const { candles, ticker } = await getMarketSnapshot(productId);
    return evaluateSignal(productId, candles, ticker, Date.now());
  } catch (error) {
    return unavailable(productId, error, Date.now());
  }
}

// One bad product never fails the refresh: it is recorded as a blocked evaluation instead.
export async function refreshSignals(userId: string | null): Promise<SignalRecord[]> {
  const evaluations = await Promise.all(WATCHLIST.map((productId) => evaluate(productId)));
  const records: SignalRecord[] = [];
  for (const evaluation of evaluations) {
    const record = await insertSignal(evaluation);
    if (userId) {
      await appendAudit(userId, "signal", "evaluated", `${record.productId}: ${record.action} — ${record.setup}`);
    }
    records.push(record);
  }
  return records;
}

// Per-process single flight: concurrent page loads (and a click on Refresh) share one evaluation, so a
// burst of requests writes one row per product, not one per request.
let inflight: Promise<SignalRecord[]> | null = null;
let lastRefreshedAt = 0;

/** Refreshes the watchlist unless a refresh is already running, in which case it joins that one. */
export function refreshSignalsOnce(userId: string | null): Promise<SignalRecord[]> {
  if (!inflight) {
    inflight = refreshSignals(userId)
      .then((records) => {
        lastRefreshedAt = Date.now();
        return records;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

const onWatchlist = (signal: SignalRecord) => (WATCHLIST as readonly string[]).includes(signal.productId);

/** Stale when a watchlist product has no signal or its latest one is older than SIGNAL_REFRESH_AFTER_MS. */
export function signalsAreStale(signals: ReadonlyArray<Pick<SignalRecord, "productId" | "evaluatedAt">>, nowMs: number): boolean {
  const latest = new Map(signals.map((s) => [s.productId, Date.parse(s.evaluatedAt)]));
  return WATCHLIST.some((productId) => {
    const at = latest.get(productId);
    return at === undefined || !Number.isFinite(at) || nowMs - at > SIGNAL_REFRESH_AFTER_MS;
  });
}

/**
 * The latest signal per watchlist product, re-evaluated first when they are stale. A failed automatic
 * refresh is logged and the stored (stale) signals are returned; the page shows their age.
 */
export async function latestFreshSignals(userId: string | null): Promise<SignalRecord[]> {
  const current = (await latestSignals()).filter(onWatchlist);
  const now = Date.now();
  if (!signalsAreStale(current, now)) {
    return current;
  }
  // This read raced a refresh that has just finished (another request): use its rows, do not refresh again.
  if (!inflight && now - lastRefreshedAt < 5_000) {
    return (await latestSignals()).filter(onWatchlist);
  }
  try {
    const records = await refreshSignalsOnce(userId);
    return [...records].sort((a, b) => a.productId.localeCompare(b.productId));
  } catch (error) {
    console.error("automatic signal refresh failed", error);
    return current;
  }
}

export async function latestSignalsWithSizing(limits: TradingLimits): Promise<Array<SignalRecord & { suggestedQuoteUsd: number }>> {
  const signals = await latestFreshSignals(limits.userId || null);
  return signals.map((signal) => ({ ...signal, suggestedQuoteUsd: suggestedQuoteUsd(limits, signal.atrPct, signal.productId) }));
}

/** Tests only: forget the single-flight state. */
export function __resetSignalRefresh(): void {
  inflight = null;
  lastRefreshedAt = 0;
}
