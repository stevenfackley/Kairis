import type { Metadata } from "next";
import { ExchangeConnectForm } from "@/components/exchange-connect-form";
import { env } from "@/lib/env";
import { when } from "@/lib/format";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { requireOnboarded } from "@/lib/server/session";
import { disconnectExchangeAction } from "./actions";
import "./exchange.css";

export const metadata: Metadata = { title: "Exchange | Kairis" };

/** A permission in words and colour. `wanted` is whether holding it is the safe answer. */
function Permission({ granted, wanted }: { granted: boolean; wanted: boolean }) {
  const ok = granted === wanted;
  const tone = ok ? "pill-ok" : wanted ? "pill-warn" : "pill-bad";
  return <span className={`pill ${tone}`}>{granted ? "Granted" : "Not granted"}</span>;
}

export default async function ExchangePage() {
  const user = await requireOnboarded("/app/exchange");
  const connection = await getConnectionStatus(user.id);
  const enabled = env.secretKey !== "";

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Exchange</p>
        <h1>Connect Coinbase</h1>
        <p className="lede">Assisted orders run on your own Coinbase account. Kairis never holds your funds.</p>
      </header>

      <section className="panel" aria-labelledby="policy-heading">
        <h2 id="policy-heading">Key policy</h2>
        <ul>
          <li>
            Use a Coinbase Developer Platform secret API key. Either signature algorithm works: Ed25519 (the default) or ECDSA.
          </li>
          <li>Create it with View and Trade permissions only. Never grant Transfer.</li>
          <li>Kairis validates the key with Coinbase and refuses any key that can transfer funds.</li>
          <li>The private key is encrypted at rest and never shown again.</li>
        </ul>
      </section>

      {!enabled ? (
        <div className="banner-halt exchange-notice" role="status">
          <strong>DISABLED</strong>
          <span>Exchange connections are disabled on this deployment: KAIRIS_SECRET_KEY is not set.</span>
        </div>
      ) : null}

      {connection ? (
        <section className="panel" aria-labelledby="connected-heading">
          <div className="panel-heading">
            <h2 id="connected-heading">Connected key</h2>
            <span className="pill pill-ok">Connected</span>
          </div>
          <div className="status-stack">
            <div className="status-row">
              <span>Key id</span>
              <strong>
                <code>{connection.keyId}</code>
              </strong>
            </div>
            <div className="status-row">
              <span>View permission</span>
              <Permission granted={connection.canView} wanted />
            </div>
            <div className="status-row">
              <span>Trade permission</span>
              <Permission granted={connection.canTrade} wanted />
            </div>
            <div className="status-row">
              <span>Transfer permission</span>
              <Permission granted={connection.canTransfer} wanted={false} />
            </div>
            <div className="status-row">
              <span>Portfolio id</span>
              <strong>{connection.portfolioUuid ? <code>{connection.portfolioUuid}</code> : "Default portfolio"}</strong>
            </div>
            <div className="status-row">
              <span>Validated at</span>
              <strong>{when(connection.validatedAt)}</strong>
            </div>
          </div>
          {!connection.canTrade ? (
            <p className="error-copy">
              This key has no Trade permission, so assisted orders will be blocked. Disconnect it and connect a key with View
              and Trade permissions.
            </p>
          ) : null}
          <form action={disconnectExchangeAction} className="exchange-disconnect">
            <label className="check">
              <input type="checkbox" name="confirm" value="yes" required />
              <span>I understand live trading will fall back to the mock provider</span>
            </label>
            <p className="field-help">Disconnecting deletes the stored key. Revoke it on Coinbase as well if you no longer use it.</p>
            <div className="button-row">
              <button type="submit" className="cta-danger">
                Disconnect
              </button>
            </div>
          </form>
        </section>
      ) : enabled ? (
        <section className="panel" aria-labelledby="connect-heading">
          <h2 id="connect-heading">Connect a key</h2>
          <ExchangeConnectForm />
        </section>
      ) : null}
    </>
  );
}
