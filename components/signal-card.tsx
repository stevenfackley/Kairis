import Link from "next/link";
import { STRATEGY } from "@/lib/domain/strategy";
import { num, pct, usd, when } from "@/lib/format";
import type { SignalAction, SignalRecord, TradeMode } from "@/lib/types";

const ACTION: Record<SignalAction, { label: string; pill: string }> = {
  long: { label: "Long", pill: "pill pill-ok" },
  observe: { label: "Observe", pill: "pill pill-warn" },
  blocked: { label: "Blocked", pill: "pill pill-bad" }
};

const MISSING = "n/a";

function dataAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return MISSING;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function ticketHref(path: "/app/paper" | "/app/trade", signal: SignalRecord & { suggestedQuoteUsd: number }): string {
  const params = new URLSearchParams({ product: signal.productId });
  if (signal.suggestedQuoteUsd > 0) params.set("quote", signal.suggestedQuoteUsd.toFixed(2));
  params.set("signal", signal.id);
  return `${path}?${params.toString()}`;
}

type SignalCardProps = { signal: SignalRecord & { suggestedQuoteUsd: number }; mode: TradeMode };

export function SignalCard({ signal, mode }: SignalCardProps) {
  const action = ACTION[signal.action];
  // A failed market fetch is stored with price 0: say "n/a" rather than imply a $0 market.
  const hasMarket = signal.referencePrice > 0;
  const budgetPct = Math.round(STRATEGY.riskBudgetFraction * 100);

  return (
    <article className="signal-card" data-action={signal.action}>
      <div className="signal-header">
        <div>
          <h3>{signal.productId}</h3>
          <p className="signal-setup">{signal.setup}</p>
        </div>
        <span className={action.pill}>{action.label}</span>
      </div>

      <p className="signal-meta">
        <span>Strength {Math.round(signal.strength * 100)}%</span>
      </p>

      {signal.rationale.length > 0 ? (
        <ul className="signal-rationale" aria-label="Why this signal fired">
          {signal.rationale.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}

      <div className="status-stack">
        <div className="status-row">
          <span>Reference price</span>
          <strong>{hasMarket ? usd(signal.referencePrice) : MISSING}</strong>
        </div>
        <div className="status-row">
          <span>RSI 14</span>
          <strong>{signal.rsi === null ? MISSING : num(signal.rsi, 2)}</strong>
        </div>
        <div className="status-row">
          <span>ATR % of price</span>
          <strong>{signal.atrPct === null ? MISSING : pct(signal.atrPct)}</strong>
        </div>
        <div className="status-row">
          <span>Spread</span>
          <strong>{signal.spreadPct === null ? MISSING : pct(signal.spreadPct, 3)}</strong>
        </div>
        <div className="status-row">
          <span>Data age at evaluation</span>
          <strong>{hasMarket ? dataAge(signal.dataAgeMs) : MISSING}</strong>
        </div>
        <div className="status-row">
          <span>Evaluated</span>
          <strong>{when(signal.evaluatedAt)}</strong>
        </div>
        <div className="status-row">
          <span>Suggested size for you</span>
          <strong>{signal.suggestedQuoteUsd > 0 ? usd(signal.suggestedQuoteUsd) : "None"}</strong>
        </div>
      </div>

      <p className="field-help signal-sizing">
        {signal.suggestedQuoteUsd > 0
          ? `Sized from ${budgetPct}% of your daily loss cap divided by ATR, capped at your max position. Per-symbol caps still apply at order time.`
          : "No size suggested until ATR is available."}
      </p>

      <div className="button-row signal-actions">
        <Link className="cta-secondary" href={ticketHref("/app/paper", signal)}>
          Trade in paper
        </Link>
        {signal.action === "long" ? (
          <Link className="cta-primary" href={ticketHref("/app/trade", signal)}>
            Prepare assisted
          </Link>
        ) : null}
      </div>
      {signal.action === "long" && mode === "paper" ? (
        <p className="field-help">
          You are in paper mode. An assisted order needs a connected exchange and live trading turned on; the Trade page
          shows what is missing. Nothing is placed without your approval.
        </p>
      ) : null}
    </article>
  );
}
