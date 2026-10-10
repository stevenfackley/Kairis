import type { Metadata } from "next";
import "./signals.css";
import { refreshSignalsAction } from "@/app/app/signals/actions";
import { RefreshButton } from "@/app/app/signals/refresh-button";
import { ModeBadge } from "@/components/mode-badge";
import { SignalCard } from "@/components/signal-card";
import { STRATEGY } from "@/lib/domain/strategy";
import { env } from "@/lib/env";
import { getLimits } from "@/lib/server/repos/limits";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { latestSignalsWithSizing, SIGNAL_REFRESH_AFTER_MS } from "@/lib/server/services/signals";
import { requireOnboarded } from "@/lib/server/session";
import type { TradeMode } from "@/lib/types";

export const metadata: Metadata = { title: "Signals | Kairis" };

const REFRESH_MIN = SIGNAL_REFRESH_AFTER_MS / 60_000;

export default async function SignalsPage() {
  const user = await requireOnboarded("/app/signals");
  const [limits, connection] = await Promise.all([getLimits(user.id), getConnectionStatus(user.id)]);
  // Re-evaluates the watchlist first when the latest signals are older than 15 minutes.
  const signals = await latestSignalsWithSizing(limits);
  // Same rule as the app layout: live only with a connected exchange and the deploy flag on.
  const mode: TradeMode = connection && env.liveAssistedTradingEnabled ? "live" : "paper";
  // Request-time clock for "evaluated N min ago"; this page renders per request.
  const nowMs = new Date().getTime();
  const oldestMs = signals.reduce((oldest, s) => Math.min(oldest, Date.parse(s.evaluatedAt)), Number.POSITIVE_INFINITY);
  const staleMinutes = Number.isFinite(oldestMs) && nowMs - oldestMs > SIGNAL_REFRESH_AFTER_MS ? Math.floor((nowMs - oldestMs) / 60_000) : null;

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Signal review</p>
        <h1>Signals</h1>
        <p className="lede">
          Each product on the watchlist is checked against completed hourly Coinbase candles (the hour still in progress
          is left out). A long setup needs EMA {STRATEGY.emaFast} to cross above EMA {STRATEGY.emaSlow} within the last{" "}
          {STRATEGY.crossLookback} hourly candles, with RSI {STRATEGY.rsiPeriod} between {STRATEGY.rsiMin} and{" "}
          {STRATEGY.rsiMax}. A setup is blocked when the spread is over {STRATEGY.maxSpreadPct}%, when ATR is over{" "}
          {STRATEGY.maxAtrPct}% of price, or when market data is stale. Signals are rule-based context for your own
          decision, not advice, and they do not predict returns.
        </p>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <h2>Latest evaluation</h2>
          <ModeBadge mode={mode} />
        </div>
        <p className="panel-copy">
          Signals are the same for every user. The suggested size is yours: it comes from your own limits. Signals older
          than {REFRESH_MIN} minutes are re-evaluated automatically when you open this page or the dashboard; you can also
          refresh now. Every evaluation is logged.
        </p>
        {staleMinutes !== null ? (
          <p className="error-copy" role="alert">
            These signals are {staleMinutes} min old: the automatic refresh did not complete. Refresh to try again, and treat
            them as out of date until then.
          </p>
        ) : null}
        <form action={refreshSignalsAction} className="button-row signals-refresh">
          <RefreshButton />
        </form>
      </section>

      {signals.length === 0 ? (
        <section className="panel">
          <p className="empty">No signals evaluated yet. Refresh to evaluate the watchlist.</p>
        </section>
      ) : (
        <section className="signal-list signals-grid" aria-label="Signals">
          {signals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} mode={mode} nowMs={nowMs} />
          ))}
        </section>
      )}
    </>
  );
}
