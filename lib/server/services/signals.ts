import { evaluateSignal, suggestedQuoteUsd } from "@/lib/domain/signals";
import { WATCHLIST } from "@/lib/domain/strategy";
import { appendAudit } from "@/lib/server/repos/audit";
import { insertSignal, latestSignals } from "@/lib/server/repos/signals";
import { getMarketSnapshot } from "@/lib/server/services/market";
import { errorMessage } from "@/lib/server/services/shared";
import type { SignalEvaluation, SignalRecord, TradingLimits } from "@/lib/types";

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

export async function latestSignalsWithSizing(limits: TradingLimits): Promise<Array<SignalRecord & { suggestedQuoteUsd: number }>> {
  const signals = await latestSignals();
  return signals.map((signal) => ({ ...signal, suggestedQuoteUsd: suggestedQuoteUsd(limits, signal.atrPct) }));
}
