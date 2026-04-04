import Link from "next/link";
import { Phase4Client } from "@/components/phase4-client";
import { paperMetrics, paperSignals } from "@/lib/phase3-content";
import { getPhase4Snapshot } from "@/lib/server/phase4-store";

export default async function PaperPage() {
  const snapshot = await getPhase4Snapshot();

  return (
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Paper Mode</p>
        <h1>Simulation Workspace</h1>
        <p className="lede">
          This workspace exists to teach the product before live execution is
          unlocked. Signals, position sizing, and controls should all be
          observable in a zero-custody, zero-execution environment.
        </p>
      </section>

      <section className="metric-grid">
        {paperMetrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <p className="metric-label">{metric.label}</p>
            <p className={`metric-value metric-${metric.tone}`}>{metric.value}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <p className="eyebrow">Signal Review</p>
          <h2>Current Paper Queue</h2>
        </div>

        <div className="signal-list">
          {paperSignals.map((signal) => (
            <article className="signal-card" key={signal.market}>
              <div className="signal-header">
                <div>
                  <p className="metric-label">{signal.market}</p>
                  <h3>{signal.setup}</h3>
                </div>
                <span className="signal-action">{signal.action}</span>
              </div>
              <p className="panel-copy">{signal.note}</p>
            </article>
          ))}
        </div>
      </section>

      <Phase4Client initialSnapshot={snapshot} scope="paper" />

      <nav className="inline-nav">
        <Link href="/onboarding">Back to onboarding</Link>
        <Link href="/connect-exchange">Continue to exchange setup</Link>
        <Link href="/reports">Review reports and exports</Link>
      </nav>
    </main>
  );
}
