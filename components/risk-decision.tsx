import { when } from "@/lib/format";
import type { RiskDecision } from "@/lib/types";

const outcomeCopy: Record<RiskDecision["outcome"], { label: string; pill: string; lede: string }> = {
  approved: { label: "Approved", pill: "pill pill-ok", lede: "Every control passed. You can proceed." },
  blocked: { label: "Blocked", pill: "pill pill-bad", lede: "This order was stopped before it reached the exchange. Nothing was placed; the reason is below." },
  halted: { label: "Halted", pill: "pill pill-warn", lede: "Trading is halted until the condition below clears. Nothing was placed." }
};

export function RiskDecisionView({ decision, title = "Risk checks" }: { decision: RiskDecision; title?: string }) {
  const copy = outcomeCopy[decision.outcome];

  return (
    <section className="panel risk-decision" aria-live="polite">
      <div className="signal-header">
        <div>
          <p className="eyebrow">{title}</p>
          <h3>{copy.label}</h3>
        </div>
        <span className={copy.pill}>{copy.label}</span>
      </div>
      <p className="panel-copy">{copy.lede}</p>
      {decision.reasons.length > 0 ? (
        <ul className="risk-reasons">
          {decision.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <ul className="risk-checks">
        {decision.checks.map((check) => (
          <li className="risk-check" data-passed={check.passed ? "true" : "false"} key={check.code}>
            <span className="risk-check-code">{check.code}</span>
            <span className="risk-check-detail">{check.detail}</span>
          </li>
        ))}
      </ul>
      <p className="panel-copy risk-evaluated">Evaluated {when(decision.evaluatedAt)}</p>
    </section>
  );
}
