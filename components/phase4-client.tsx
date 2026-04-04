"use client";

import { useState, useTransition } from "react";
import type {
  ExecutionMode,
  OnboardingState,
  PaperTrade,
  Phase4Snapshot,
  TradingLimits
} from "@/lib/types";

type SnapshotPanelProps = {
  initialSnapshot: Phase4Snapshot;
  scope: "onboarding" | "paper" | "reports";
};

async function postJson<TResponse>(
  url: string,
  body?: unknown
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

async function getJson<TResponse>(url: string): Promise<TResponse> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as TResponse;
}

export function Phase4Client({ initialSnapshot, scope }: SnapshotPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    startTransition(async () => {
      try {
        setError(null);
        const next = await getJson<Phase4Snapshot>("/api/phase4/snapshot");
        setSnapshot(next);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "Refresh failed.");
      }
    });
  };

  const saveOnboarding = (preferredMode: ExecutionMode) => {
    startTransition(async () => {
      try {
        setError(null);
        await postJson<OnboardingState>("/api/phase4/onboarding", {
          preferredMode,
          riskAcknowledged: true,
          exchangeConnected: preferredMode !== "paper"
        });
        const next = await getJson<Phase4Snapshot>("/api/phase4/snapshot");
        setSnapshot(next);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to save onboarding.");
      }
    });
  };

  const saveLimits = () => {
    startTransition(async () => {
      try {
        setError(null);
        await postJson<TradingLimits>("/api/phase4/limits", {
          maxPositionUsd: 2000,
          dailyLossCapUsd: 350,
          maxTradesPerDay: 8,
          cooldownMinutes: 30
        });
        const next = await getJson<Phase4Snapshot>("/api/phase4/snapshot");
        setSnapshot(next);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to save limits.");
      }
    });
  };

  const addTrade = () => {
    startTransition(async () => {
      try {
        setError(null);
        await postJson<PaperTrade>("/api/phase4/paper-trades", {
          symbol: "BTC-USD",
          side: "buy",
          quantity: 0.05,
          entryPrice: 68120,
          status: "planned",
          note: "Phase 4 simulated journal entry."
        });
        const next = await getJson<Phase4Snapshot>("/api/phase4/snapshot");
        setSnapshot(next);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to add paper trade.");
      }
    });
  };

  const createExport = () => {
    startTransition(async () => {
      try {
        setError(null);
        await postJson("/api/phase4/exports");
        const next = await getJson<Phase4Snapshot>("/api/phase4/snapshot");
        setSnapshot(next);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Unable to create export.");
      }
    });
  };

  return (
    <section className="phase4-stack">
      <div className="phase4-actions">
        {scope === "onboarding" ? (
          <>
            <button className="cta-primary button-reset" onClick={() => saveOnboarding("paper")} type="button">
              Save paper-first onboarding
            </button>
            <button className="cta-secondary button-reset" onClick={() => saveOnboarding("assisted")} type="button">
              Save assisted-ready onboarding
            </button>
          </>
        ) : null}

        {scope === "paper" ? (
          <>
            <button className="cta-primary button-reset" onClick={addTrade} type="button">
              Add simulated trade
            </button>
            <button className="cta-secondary button-reset" onClick={saveLimits} type="button">
              Save tighter limits
            </button>
          </>
        ) : null}

        {scope === "reports" ? (
          <>
            <button className="cta-primary button-reset" onClick={createExport} type="button">
              Create paper journal export
            </button>
            <button className="cta-secondary button-reset" onClick={refresh} type="button">
              Refresh state
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="error-copy">{error}</p> : null}
      {isPending ? <p className="panel-copy">Updating Phase 4 state…</p> : null}

      <div className="phase4-grid">
        <article className="panel">
          <p className="eyebrow">Onboarding State</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Preferred mode</span>
              <strong>{snapshot.onboarding.preferredMode}</strong>
            </div>
            <div className="status-row">
              <span>Risk acknowledged</span>
              <strong>{snapshot.onboarding.riskAcknowledged ? "Yes" : "No"}</strong>
            </div>
            <div className="status-row">
              <span>Exchange connected</span>
              <strong>{snapshot.onboarding.exchangeConnected ? "Yes" : "No"}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Risk Limits</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Max position</span>
              <strong>${snapshot.limits.maxPositionUsd}</strong>
            </div>
            <div className="status-row">
              <span>Daily loss cap</span>
              <strong>${snapshot.limits.dailyLossCapUsd}</strong>
            </div>
            <div className="status-row">
              <span>Max trades/day</span>
              <strong>{snapshot.limits.maxTradesPerDay}</strong>
            </div>
          </div>
        </article>
      </div>

      <article className="panel">
        <p className="eyebrow">Storage Mode</p>
        <div className="status-stack">
          <div className="status-row">
            <span>Data provider</span>
            <strong>{snapshot.storage.provider}</strong>
          </div>
          <div className="status-row">
            <span>Artifact provider</span>
            <strong>{snapshot.storage.artifacts}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Paper Journal</p>
        <div className="signal-list">
          {snapshot.paperTrades.map((trade) => (
            <div className="signal-card" key={trade.id}>
              <div className="signal-header">
                <div>
                  <p className="metric-label">{trade.symbol}</p>
                  <h3>
                    {trade.side.toUpperCase()} {trade.quantity} @ {trade.entryPrice}
                  </h3>
                </div>
                <span className="signal-action">{trade.status}</span>
              </div>
              <p className="panel-copy">{trade.note}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Audit Trail</p>
        <div className="signal-list">
          {snapshot.auditEvents.slice(0, 6).map((event) => (
            <div className="signal-card" key={event.id}>
              <div className="signal-header">
                <div>
                  <p className="metric-label">
                    {event.category} · {event.action}
                  </p>
                  <h3>{new Date(event.createdAt).toLocaleString()}</h3>
                </div>
              </div>
              <p className="panel-copy">{event.detail}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Exports</p>
        <div className="signal-list">
          {snapshot.exports.length === 0 ? (
            <p className="panel-copy">No export artifacts created yet.</p>
          ) : (
            snapshot.exports.map((artifact) => (
              <div className="signal-card" key={artifact.id}>
                <div className="signal-header">
                  <div>
                    <p className="metric-label">{artifact.type}</p>
                    <h3>{artifact.storage}</h3>
                  </div>
                </div>
                <p className="panel-copy">{artifact.location}</p>
              </div>
            ))
          )}
        </div>
      </article>
    </section>
  );
}
