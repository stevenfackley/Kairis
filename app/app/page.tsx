import type { Metadata } from "next";
import Link from "next/link";
import { togglePauseAction } from "@/app/app/actions";
import { ModeBadge } from "@/components/mode-badge";
import { PositionsTable } from "@/components/positions-table";
import { evaluatedAgo, isSignalStale } from "@/components/signal-card";
import { buildPositions, dayStats } from "@/lib/domain/paper";
import { env } from "@/lib/env";
import { short, usd, when } from "@/lib/format";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { getLimits } from "@/lib/server/repos/limits";
import { getOnboarding } from "@/lib/server/repos/onboarding";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { getReferencePrices } from "@/lib/server/services/market";
import { HISTORY_LIMIT } from "@/lib/server/services/risk";
import { latestSignalsWithSizing } from "@/lib/server/services/signals";
import { requireOnboarded } from "@/lib/server/session";
import type { AssistedStatus, ExecutionMode, SignalAction, TradeMode } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard | Kairis" };

const MODE_LABEL: Record<ExecutionMode, string> = { paper: "Paper", manual: "Manual", assisted: "Assisted", auto: "Auto (owner)" };

const ACTION_LABEL: Record<SignalAction, string> = { long: "Long setup", observe: "Observe", blocked: "Blocked" };

const STATUS_PILL: Record<AssistedStatus, "pill-ok" | "pill-warn" | "pill-bad"> = {
  filled: "pill-ok",
  previewed: "pill-warn",
  submitted: "pill-warn",
  cancelled: "pill-warn",
  expired: "pill-warn",
  blocked: "pill-bad",
  failed: "pill-bad"
};

function signedUsd(n: number): string {
  return n > 0 ? `+${usd(n)}` : usd(n);
}

export default async function DashboardPage() {
  const user = await requireOnboarded("/app");
  const limitsPromise = getLimits(user.id);
  const [limits, signals, onboarding, connection, paperTrades, assistedOrders] = await Promise.all([
    limitsPromise,
    limitsPromise.then((l) => latestSignalsWithSizing(l)),
    getOnboarding(user.id),
    getConnectionStatus(user.id),
    listPaperTrades(user.id, HISTORY_LIMIT),
    listAssistedOrders(user.id, 50)
  ]);
  const held = Object.keys(buildPositions(paperTrades, {}));
  const prices = held.length > 0 ? await getReferencePrices(held) : {};
  const positions = buildPositions(paperTrades, prices);
  const now = new Date();
  const nowMs = now.getTime();
  const today = dayStats(paperTrades, now);
  const mode: TradeMode = connection && env.liveAssistedTradingEnabled ? "live" : "paper";
  const capCount = Object.keys(limits.perSymbolMaxUsd).length;
  const recentOrders = assistedOrders.slice(0, 5);
  const topSignals = signals.slice(0, 3);

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Dashboard</p>
        <h1>Overview</h1>
      </header>

      <section className="panel" aria-labelledby="now-heading">
        <h2 id="now-heading">Now</h2>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Mode</span>
            <span className="stat-value">
              <ModeBadge mode={mode} />
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Preferred mode</span>
            <span className="stat-value">{MODE_LABEL[onboarding.preferredMode]}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Exchange connected</span>
            <span className="stat-value">{connection ? "Yes" : "No"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Live trading enabled</span>
            <span className="stat-value">{env.liveAssistedTradingEnabled ? "Yes" : "No"}</span>
          </div>
        </div>
      </section>

      <section className="grid">
        <article className="panel kill-switch" data-paused={limits.tradingPaused ? "true" : "false"}>
          <h2>Kill switch</h2>
          <p className="panel-copy">
            {limits.tradingPaused
              ? "Trading is paused. No new paper or live order can be placed until you resume."
              : "Trading is active. Pausing stops every new paper and live order at once. Orders already at the exchange are not cancelled."}
          </p>
          <form action={togglePauseAction} className="button-row">
            <input type="hidden" name="paused" value={limits.tradingPaused ? "false" : "true"} />
            <button type="submit" className={limits.tradingPaused ? "cta-secondary" : "cta-danger"}>
              {limits.tradingPaused ? "Resume trading" : "Pause trading"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Limits</h2>
            <Link className="inline-link" href="/app/controls">
              Edit in Controls
            </Link>
          </div>
          <p className="panel-copy">These protect you on every order, paper and live.</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Max position</span>
              <strong>{usd(limits.maxPositionUsd)}</strong>
            </div>
            <div className="status-row">
              <span>Daily loss cap</span>
              <strong>{usd(limits.dailyLossCapUsd)}</strong>
            </div>
            <div className="status-row">
              <span>Trades per day</span>
              <strong>{limits.maxTradesPerDay}</strong>
            </div>
            <div className="status-row">
              <span>Cooldown after {limits.lossStreakTrigger} losses in a row</span>
              <strong>{limits.cooldownMinutes} min</strong>
            </div>
            <div className="status-row">
              <span>Per-symbol caps</span>
              <strong>{capCount === 0 ? "None set" : capCount}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel" data-mode="paper">
          <div className="panel-heading">
            <h2>Today (UTC)</h2>
            <ModeBadge mode="paper" />
          </div>
          <div className="status-stack">
            <div className="status-row">
              <span>Trades used today (UTC)</span>
              <strong>
                {today.tradesCount} of {limits.maxTradesPerDay}
              </strong>
            </div>
            <div className="status-row">
              <span>Realized P&amp;L today (UTC)</span>
              <strong>{signedUsd(today.realizedPnlUsd)}</strong>
            </div>
            <div className="status-row">
              <span>Consecutive losses (last 24 h)</span>
              <strong>
                {today.consecutiveLosses} of {limits.lossStreakTrigger} before cooldown
              </strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Latest signals</h2>
            <Link className="inline-link" href="/app/signals">
              Review signals
            </Link>
          </div>
          {topSignals.length === 0 ? (
            <p className="empty">No signals yet. Open Signals and refresh to evaluate the watchlist.</p>
          ) : (
            <div className="signal-list">
              {topSignals.map((signal) => (
                <Link className="signal-card signal-link" href="/app/signals" key={signal.id}>
                  <div className="signal-header">
                    <h3>{signal.productId}</h3>
                    <span className="signal-action" data-action={signal.action}>
                      {ACTION_LABEL[signal.action]}
                    </span>
                  </div>
                  <p className="signal-setup">{signal.setup}</p>
                  {signal.rationale.length > 0 ? (
                    <ul className="signal-rationale">
                      {signal.rationale.slice(0, 2).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="signal-meta">
                    <span>
                      Suggested size:{" "}
                      {signal.action === "long" && signal.suggestedQuoteUsd > 0 ? usd(signal.suggestedQuoteUsd) : "none"}
                    </span>
                    <span>Evaluated {evaluatedAgo(signal.evaluatedAt, nowMs)}</span>
                  </p>
                  {isSignalStale(signal.evaluatedAt, nowMs) ? (
                    <p className="error-copy" role="status">
                      Stale: evaluated {evaluatedAgo(signal.evaluatedAt, nowMs)}. Refresh before acting on it.
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="panel" data-mode="paper">
        <div className="panel-heading">
          <h2>Positions</h2>
          <ModeBadge mode="paper" />
        </div>
        <PositionsTable positions={positions} prices={prices} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Recent assisted orders</h2>
          <Link className="inline-link" href="/app/trade">
            Open Trade
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <p className="empty">No assisted orders yet. Orders you approve on the Trade page appear here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Order</th>
                  <th scope="col">Product</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="num">Size</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>{when(order.createdAt)}</td>
                    <td>
                      <code>{short(order.id)}</code>
                    </td>
                    <td>{order.productId}</td>
                    <td>{order.side}</td>
                    <td className="num">{usd(order.quoteUsd)}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[order.status]}`}>{order.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
