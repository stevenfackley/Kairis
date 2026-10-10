import type { Metadata } from "next";
import Link from "next/link";
import { AssistedOrdersTable } from "@/components/assisted-orders-table";
import { AssistedTicket } from "@/components/assisted-ticket";
import { ModeBadge } from "@/components/mode-badge";
import { env } from "@/lib/env";
import { usd } from "@/lib/format";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { getLimits } from "@/lib/server/repos/limits";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { requireOnboarded } from "@/lib/server/session";
import type { Side } from "@/lib/types";
import { reconcileAction } from "./actions";
import { isUuid, normalizeProduct } from "./order-form";
import "./trade.css";

export const metadata: Metadata = { title: "Assisted trading | Kairis" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function quoteParam(raw: string): string {
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n.toFixed(2) : "";
}

export default async function TradePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireOnboarded("/app/trade");
  const params = await searchParams;
  const [connection, limits, orders] = await Promise.all([
    getConnectionStatus(user.id),
    getLimits(user.id),
    listAssistedOrders(user.id, 50)
  ]);

  const product = normalizeProduct(first(params.product)) ?? "";
  const quote = quoteParam(first(params.quote));
  const side: Side = first(params.side).toUpperCase() === "SELL" ? "SELL" : "BUY";
  const signal = first(params.signal);
  const signalId = isUuid(signal) ? signal : null;
  // The server opens the stored key only when KAIRIS_SECRET_KEY is set; otherwise orders use the mock provider.
  const provider = connection && env.secretKey ? "coinbase" : "mock";
  const caps = Object.entries(limits.perSymbolMaxUsd);

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Assisted mode</p>
        <div className="trade-mode">
          <ModeBadge mode={provider === "coinbase" ? "live" : "paper"} />
          <span className="field-help">
            {provider === "coinbase"
              ? "Orders go to your Coinbase account, and only after you confirm."
              : "No exchange is connected, so assisted orders run against the mock provider. Nothing reaches an exchange."}
          </span>
        </div>
        <h1>Assisted trading</h1>
        <p className="lede">
          Kairis checks the order against your limits, fetches a Coinbase preview, and submits only after you confirm. Every step
          is recorded.
        </p>
      </header>

      {!env.liveAssistedTradingEnabled ? (
        <div className="banner-halt trade-notice" role="status">
          <strong>LIVE OFF</strong>
          <span>
            Live submission is disabled by environment policy (ENABLE_LIVE_ASSISTED_TRADING=false). Previews work; a Coinbase
            submit will be blocked and recorded.
          </span>
        </div>
      ) : null}

      {provider === "mock" ? (
        <section className="panel" aria-labelledby="mock-heading">
          <div className="panel-heading">
            <h2 id="mock-heading">Mock provider active</h2>
            <span className="pill pill-warn">Mock</span>
          </div>
          <p className="panel-copy">
            {connection
              ? "A Coinbase key is stored, but this deployment cannot open it (KAIRIS_SECRET_KEY is not set), so the mock provider is used."
              : "No Coinbase key is connected. Previews and orders use the mock provider: simulated prices and fills, nothing sent anywhere."}{" "}
            <Link className="inline-link" href="/app/exchange">
              Go to Exchange
            </Link>
          </p>
        </section>
      ) : null}

      <section className="split-panel trade-split">
        <article className="panel" aria-labelledby="ticket-heading">
          <h2 id="ticket-heading">New assisted order</h2>
          <AssistedTicket
            key={`${product}|${side}|${quote}|${signalId ?? ""}`}
            provider={provider}
            liveSubmitEnabled={env.liveAssistedTradingEnabled}
            defaultProduct={product}
            defaultSide={side}
            defaultQuote={quote}
            signalId={signalId}
          />
        </article>

        <aside className="panel" aria-labelledby="limits-heading">
          <div className="panel-heading">
            <h2 id="limits-heading">Limits that apply</h2>
            <Link className="inline-link" href="/app/controls">
              Edit in Controls
            </Link>
          </div>
          <p className="panel-copy">Checked before the preview and again at submit.</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Kill switch</span>
              <strong>{limits.tradingPaused ? "Paused" : "Off"}</strong>
            </div>
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
            {caps.length === 0 ? (
              <div className="status-row">
                <span>Per-symbol caps</span>
                <strong>None set</strong>
              </div>
            ) : (
              caps.map(([productId, cap]) => (
                <div className="status-row" key={productId}>
                  <span>{productId} cap</span>
                  <strong>{usd(cap)}</strong>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>

      <section className="panel" aria-labelledby="orders-heading">
        <div className="panel-heading">
          <h2 id="orders-heading">Recent assisted orders</h2>
          <form action={reconcileAction}>
            <button type="submit" className="cta-secondary">
              Reconcile now
            </button>
          </form>
        </div>
        <AssistedOrdersTable orders={orders} />
      </section>
    </>
  );
}
