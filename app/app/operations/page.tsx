import type { Metadata } from "next";
import { reconcileAllAction, runAutoCycleAction } from "@/app/app/operations/actions";
import { firstString } from "@/lib/search-params";
import { listAssistedOrders, listPendingAssistedOrders } from "@/lib/server/repos/assisted";
import { listAudit } from "@/lib/server/repos/audit";
import { listExports } from "@/lib/server/repos/exports";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { latestSignals } from "@/lib/server/repos/signals";
import type { AutoCycleSummary } from "@/lib/server/services/auto";
import { getConnectionStatus } from "@/lib/server/services/exchange-connection";
import { requireOwner } from "@/lib/server/session";
import { getSystemStatus } from "@/lib/server/system-status";

export const metadata: Metadata = { title: "Operations | Kairis" };

function Pill({ ok, yes = "yes", no = "no" }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={`pill ${ok ? "pill-ok" : "pill-warn"}`}>{ok ? yes : no}</span>;
}

function parseSummary(raw: string | null): AutoCycleSummary | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Partial<AutoCycleSummary>;
    if (typeof o.evaluated !== "number" || typeof o.previewed !== "number" || typeof o.submitted !== "number" || typeof o.exited !== "number") {
      return null;
    }
    return {
      evaluated: o.evaluated,
      previewed: o.previewed,
      submitted: o.submitted,
      exited: o.exited,
      skipped: Array.isArray(o.skipped) ? o.skipped.map(String) : []
    };
  } catch {
    return null;
  }
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOwner("/app/operations");
  const sp = await searchParams;
  const error = firstString(sp, "error");
  const reconciledRaw = firstString(sp, "reconciled");
  const parts = reconciledRaw ? reconciledRaw.split(",").map((n) => Number.parseInt(n, 10)) : [];
  const reconciled = parts.length === 2 && parts.every(Number.isFinite) ? { checked: parts[0], updated: parts[1] } : null;
  const auto = parseSummary(firstString(sp, "auto"));

  const [status, paper, assisted, pending, exportsList, audit, signals, connection] = await Promise.all([
    getSystemStatus(),
    listPaperTrades(user.id, 1000),
    listAssistedOrders(user.id, 1000),
    listPendingAssistedOrders(user.id),
    listExports(user.id),
    listAudit(user.id, { limit: 500 }),
    latestSignals(),
    getConnectionStatus(user.id)
  ]);
  const gatesOpen = user.isOwner && status.autoModeEnabled && status.liveAssistedTradingEnabled && connection !== null;

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Owner</p>
        <h1>Operations</h1>
        <p className="lede">Readiness, counts and owner-only controls. Public users never see this page.</p>
      </header>

      {error ? (
        <p className="error-copy" role="alert">
          {error}
        </p>
      ) : null}

      <section className="grid">
        <article className="panel">
          <h2>System status</h2>
          <div className="status-stack">
            <div className="status-row">
              <span>App</span>
              <strong>
                {status.app} ({status.appEnv})
              </strong>
            </div>
            <div className="status-row">
              <span>Realm</span>
              <strong>{status.realm}</strong>
            </div>
            <div className="status-row">
              <span>Database</span>
              <span className={`pill ${status.services.database === "connected" ? "pill-ok" : status.services.database === "error" ? "pill-bad" : "pill-warn"}`}>
                {status.services.database}
              </span>
            </div>
            <div className="status-row">
              <span>R2 storage</span>
              <Pill ok={status.services.r2 === "configured"} yes="configured" no="missing" />
            </div>
            <div className="status-row">
              <span>Secret key</span>
              <Pill ok={status.services.secretKey === "configured"} yes="configured" no="missing" />
            </div>
            <div className="status-row">
              <span>Live assisted enabled</span>
              <Pill ok={status.liveAssistedTradingEnabled} />
            </div>
            <div className="status-row">
              <span>Auto mode enabled</span>
              <Pill ok={status.autoModeEnabled} />
            </div>
          </div>
        </article>

        <article className="panel">
          <h2>Counts</h2>
          <p className="panel-copy">Your own records only (lists capped at 1000, audit at 500).</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Paper trades</span>
              <strong>{paper.length}</strong>
            </div>
            <div className="status-row">
              <span>Assisted orders</span>
              <strong>{assisted.length}</strong>
            </div>
            <div className="status-row">
              <span>Exports</span>
              <strong>{exportsList.length}</strong>
            </div>
            <div className="status-row">
              <span>Audit events</span>
              <strong>{audit.length}</strong>
            </div>
            <div className="status-row">
              <span>Latest signals on record</span>
              <strong>{signals.length}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel" aria-labelledby="recon-heading">
        <h2 id="recon-heading">Pending reconciliation</h2>
        <p className="panel-copy">
          {pending.length} order{pending.length === 1 ? "" : "s"} awaiting exchange confirmation.
        </p>
        {reconciled ? (
          <p className="success-copy" role="status">
            Checked {reconciled.checked}, updated {reconciled.updated}.
          </p>
        ) : null}
        <form action={reconcileAllAction} className="button-row">
          <button type="submit" className="cta-secondary">
            Reconcile my pending orders
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="auto-heading">
        <h2 id="auto-heading">Auto mode</h2>
        <p className="panel-copy">
          One auto cycle evaluates the watchlist and may place live orders. It runs only when every gate is open: owner role, ENABLE_AUTO_MODE,
          ENABLE_LIVE_ASSISTED_TRADING and a connected Coinbase key. Risk limits still apply.
        </p>
        <div className="status-stack">
          <div className="status-row">
            <span>Owner role</span>
            <Pill ok={user.isOwner} />
          </div>
          <div className="status-row">
            <span>ENABLE_AUTO_MODE</span>
            <Pill ok={status.autoModeEnabled} />
          </div>
          <div className="status-row">
            <span>ENABLE_LIVE_ASSISTED_TRADING</span>
            <Pill ok={status.liveAssistedTradingEnabled} />
          </div>
          <div className="status-row">
            <span>Coinbase key connected</span>
            <Pill ok={connection !== null} />
          </div>
        </div>
        {auto ? (
          <p className="success-copy" role="status">
            Evaluated {auto.evaluated}, previewed {auto.previewed}, submitted {auto.submitted}, exited {auto.exited}.
            {auto.skipped.length > 0 ? ` Skipped: ${auto.skipped.join("; ")}` : ""}
          </p>
        ) : null}
        <form action={runAutoCycleAction} className="button-row">
          <button type="submit" className="cta-danger" disabled={!gatesOpen}>
            Run one auto cycle
          </button>
        </form>
      </section>
    </>
  );
}
