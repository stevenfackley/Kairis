import Link from "next/link";
import { Phase4Client } from "@/components/phase4-client";
import { getPhase4Snapshot } from "@/lib/server/phase4-store";

export default async function ReportsPage() {
  const snapshot = await getPhase4Snapshot();

  return (
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Phase 4</p>
        <h1>Persistence, Audit, and Export Layer</h1>
        <p className="lede">
          This layer introduces persisted onboarding state, persisted paper
          journal activity, audit events, and export artifacts. Managed
          Postgres is the intended production path; local JSON storage remains the fallback for
          development and test environments.
        </p>
      </section>

      <Phase4Client initialSnapshot={snapshot} scope="reports" />

      <nav className="inline-nav">
        <Link href="/onboarding">Back to onboarding</Link>
        <Link href="/paper">Back to paper mode</Link>
        <Link href="/assisted-live">Open assisted live flow</Link>
        <Link href="/operations">Open operations</Link>
        <Link href="/">Return to overview</Link>
      </nav>
    </main>
  );
}
