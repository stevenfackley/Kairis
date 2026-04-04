"use client";

import { useState, useTransition } from "react";
import type { Phase4Snapshot } from "@/lib/types";
import type { SystemStatus } from "@/lib/server/system-status";

type ReconcileResponse = {
  reconciled: number;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`POST failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function Phase6OperationsClient({
  initialSnapshot,
  initialStatus
}: {
  initialSnapshot: Phase4Snapshot;
  initialStatus: SystemStatus;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const [nextSnapshot, nextStatus] = await Promise.all([
          getJson<Phase4Snapshot>("/api/phase4/snapshot"),
          getJson<SystemStatus>("/api/system/status")
        ]);
        setSnapshot(nextSnapshot);
        setStatus(nextStatus);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh operations view.");
      }
    });
  };

  const reconcile = () => {
    startTransition(async () => {
      try {
        setError(null);
        const result = await postJson<ReconcileResponse>("/api/phase6/reconcile-orders");
        setMessage(`Reconciled ${result.reconciled} assisted orders.`);
        const [nextSnapshot, nextStatus] = await Promise.all([
          getJson<Phase4Snapshot>("/api/phase4/snapshot"),
          getJson<SystemStatus>("/api/system/status")
        ]);
        setSnapshot(nextSnapshot);
        setStatus(nextStatus);
      } catch (reconcileError) {
        setError(
          reconcileError instanceof Error
            ? reconcileError.message
            : "Unable to reconcile assisted orders."
        );
      }
    });
  };

  return (
    <section className="phase4-stack">
      <div className="phase4-actions">
        <button className="cta-primary button-reset" onClick={reconcile} type="button">
          Reconcile assisted orders
        </button>
        <button className="cta-secondary button-reset" onClick={refresh} type="button">
          Refresh operations state
        </button>
      </div>

      {isPending ? <p className="panel-copy">Updating operations state…</p> : null}
      {message ? <p className="success-copy">{message}</p> : null}
      {error ? <p className="error-copy">{error}</p> : null}

      <div className="phase4-grid">
        <article className="panel">
          <p className="eyebrow">Environment Readiness</p>
          <div className="status-stack">
            <div className="status-row">
              <span>App environment</span>
              <strong>{status.appEnv}</strong>
            </div>
            <div className="status-row">
              <span>Persistence</span>
              <strong>{status.storage.persistence}</strong>
            </div>
            <div className="status-row">
              <span>Artifacts</span>
              <strong>{status.storage.artifacts}</strong>
            </div>
            <div className="status-row">
              <span>Exchange provider</span>
              <strong>{status.exchangeProvider}</strong>
            </div>
            <div className="status-row">
              <span>Live assisted trading</span>
              <strong>{status.liveAssistedTradingEnabled ? "enabled" : "disabled"}</strong>
            </div>
          </div>
          <div className="status-stack">
            <div className="status-row">
              <span>Supabase public config</span>
              <strong>{status.services.supabase}</strong>
            </div>
            <div className="status-row">
              <span>Supabase admin config</span>
              <strong>{status.services.supabaseAdmin}</strong>
            </div>
            <div className="status-row">
              <span>R2 config</span>
              <strong>{status.services.r2}</strong>
            </div>
            <div className="status-row">
              <span>Coinbase config</span>
              <strong>{status.services.coinbase}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Assisted Order History</p>
          <div className="signal-list">
            {snapshot.assistedOrders.length === 0 ? (
              <p className="panel-copy">No assisted orders recorded yet.</p>
            ) : (
              snapshot.assistedOrders.map((order) => (
                <div className="signal-card" key={order.id}>
                  <div className="signal-header">
                    <div>
                      <p className="metric-label">
                        {order.provider} · {order.status}
                      </p>
                      <h3>
                        {order.side} {order.productId} · ${order.quoteSize}
                      </h3>
                    </div>
                    <span className="signal-action">{order.reconcileState}</span>
                  </div>
                  <p className="panel-copy">{order.detail}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Support Snapshot</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Audit events</span>
              <strong>{snapshot.auditEvents.length}</strong>
            </div>
            <div className="status-row">
              <span>Exports</span>
              <strong>{snapshot.exports.length}</strong>
            </div>
            <div className="status-row">
              <span>Paper trades</span>
              <strong>{snapshot.paperTrades.length}</strong>
            </div>
            <div className="status-row">
              <span>Assisted orders</span>
              <strong>{snapshot.assistedOrders.length}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
