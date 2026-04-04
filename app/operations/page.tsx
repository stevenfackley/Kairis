import Link from "next/link";
import { Phase6OperationsClient } from "@/components/phase6-operations-client";
import { getPhase4Snapshot } from "@/lib/server/phase4-store";

export default async function OperationsPage() {
  const snapshot = await getPhase4Snapshot();

  return (
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Phase 6</p>
        <h1>Operations And Beta Readiness</h1>
        <p className="lede">
          This phase adds reconciliation support, assisted order history, and an
          operator-facing dashboard so private beta issues can be understood
          without inspecting raw files or API responses directly.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Hardening Focus</h2>
          <ul>
            <li>Track assisted order lifecycle beyond preview and submit</li>
            <li>Normalize support visibility into audit and export state</li>
            <li>Keep reconciliation available in local and beta environments</li>
          </ul>
        </article>

        <article className="panel">
          <h2>Operational Posture</h2>
          <ul>
            <li>Mock provider remains safe for local and Proxmox test environments</li>
            <li>Coinbase path stays gated by explicit environment settings</li>
            <li>Production deployment stays targeted to EC2, not GitHub-hosted execution</li>
          </ul>
        </article>
      </section>

      <Phase6OperationsClient initialSnapshot={snapshot} />

      <nav className="inline-nav">
        <Link href="/assisted-live">Back to assisted live flow</Link>
        <Link href="/reports">Back to reports</Link>
        <Link href="/">Return to overview</Link>
      </nav>
    </main>
  );
}
