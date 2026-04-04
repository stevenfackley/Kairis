import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { exchangePolicies } from "@/lib/phase3-content";

export default function ConnectExchangePage() {
  const supabaseReady = Boolean(createSupabaseBrowserClient());

  return (
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Exchange Setup</p>
        <h1>Connection Policy</h1>
        <p className="lede">
          Kairis does not start with live custody assumptions. Exchange setup is
          policy-first: least privilege, spot-only support, and no withdrawal
          capability.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Required Rules</h2>
          <ul>
            {exchangePolicies.map((policy) => (
              <li key={policy}>{policy}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Current Integration State</h2>
          <div className="status-stack">
            <div className="status-row">
              <span>Supported venue class</span>
              <strong>CEX Spot</strong>
            </div>
            <div className="status-row">
              <span>Supabase storage path</span>
              <strong>{supabaseReady ? "Ready to wire" : "Needs env values"}</strong>
            </div>
            <div className="status-row">
              <span>Live execution state</span>
              <strong>Not enabled</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading">
          <p className="eyebrow">Next Integration Step</p>
          <h2>What Phase 4 Will Add</h2>
        </div>
        <p className="panel-copy">
          The next implementation layer should persist onboarding state,
          connected accounts, user limits, and paper-trading journal data in
          Supabase, then add audit logging and export-ready reporting.
        </p>
      </section>

      <nav className="inline-nav">
        <Link href="/paper">Back to paper mode</Link>
        <Link href="/reports">Open reports</Link>
        <Link href="/assisted-live">Open assisted live flow</Link>
        <Link href="/">Return to overview</Link>
      </nav>
    </main>
  );
}
