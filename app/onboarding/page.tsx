import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Phase4Client } from "@/components/phase4-client";
import { env } from "@/lib/env";
import { onboardingSteps } from "@/lib/phase3-content";
import { getPhase4Snapshot } from "@/lib/server/phase4-store";

export default async function OnboardingPage() {
  const snapshot = await getPhase4Snapshot();

  return (
    <main className="page-shell">
      <section className="page-hero">
        <BrandMark />

        <div className="page-copy">
          <p className="eyebrow">Phase 3</p>
          <h1>Guided Onboarding</h1>
          <p className="lede">
            The first live user flow starts by making execution boundaries
            explicit. Users learn the system in paper mode before any exchange
            connectivity can lead to live action.
          </p>
        </div>
      </section>

      <section className="card-grid">
        {onboardingSteps.map((item) => (
          <article className="panel" key={item.step}>
            <p className="metric-label">{item.step}</p>
            <h2>{item.title}</h2>
            <p className="panel-copy">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="panel split-panel">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Environment Readiness</h2>
          <p className="panel-copy">
            Supabase wiring is scaffolded now so onboarding can evolve into real
            authentication and account persistence without a route rewrite.
          </p>
        </div>

        <div className="status-stack">
          <div className="status-row">
            <span>Application</span>
            <strong>{env.appName}</strong>
          </div>
          <div className="status-row">
            <span>Environment</span>
            <strong>{env.appEnv}</strong>
          </div>
          <div className="status-row">
            <span>Supabase</span>
            <strong>{env.supabaseConfigured ? "Configured" : "Not configured"}</strong>
          </div>
        </div>
      </section>

      <Phase4Client initialSnapshot={snapshot} scope="onboarding" />

      <nav className="inline-nav">
        <Link href="/">Back to overview</Link>
        <Link href="/paper">Open paper workspace</Link>
        <Link href="/connect-exchange">Review exchange setup</Link>
        <Link href="/reports">Open reports</Link>
      </nav>
    </main>
  );
}
