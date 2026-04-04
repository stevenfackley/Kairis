import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

const phases = [
  {
    title: "Phase 1",
    summary: "Brand system and selected Threshold K direction."
  },
  {
    title: "Phase 2",
    summary: "App scaffold, deployment assumptions, and CI/CD foundation."
  },
  {
    title: "Phase 3",
    summary: "Onboarding, paper trading, and account setup workflows."
  }
];

const stack = [
  "Next.js App Router",
  "Supabase Pro",
  "Cloudflare R2",
  "GitHub Actions",
  "Proxmox test environments",
  "AWS EC2 production"
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <BrandMark />

        <div className="hero-copy">
          <p className="eyebrow">Threshold K</p>
          <h1>Kairis</h1>
          <p className="lede">
            A disciplined execution system for non-custodial crypto trading.
            Built around visible control boundaries, staged execution modes, and
            infrastructure that fits the actual operating constraints.
          </p>
        </div>
      </section>

      <section className="cta-strip">
        <Link className="cta-primary" href="/onboarding">
          Start onboarding flow
        </Link>
        <Link className="cta-secondary" href="/paper">
          Open paper workspace
        </Link>
        <Link className="cta-secondary" href="/connect-exchange">
          Review exchange setup
        </Link>
        <Link className="cta-secondary" href="/reports">
          Open reports
        </Link>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Current Scope</h2>
          <ul>
            <li>Centralized exchange spot only</li>
            <li>Manual and assisted public execution</li>
            <li>Owner-only automation path</li>
            <li>No custody and no withdrawal permissions</li>
          </ul>
        </article>

        <article className="panel">
          <h2>Infrastructure Baseline</h2>
          <ul>
            {stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel roadmap">
        <div className="section-heading">
          <p className="eyebrow">Implementation</p>
          <h2>Delivery Path</h2>
        </div>

        <div className="roadmap-list">
          {phases.map((phase) => (
            <article className="roadmap-item" key={phase.title}>
              <h3>{phase.title}</h3>
              <p>{phase.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
