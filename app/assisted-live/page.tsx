import Link from "next/link";
import { Phase5AssistedClient } from "@/components/phase5-assisted-client";

export default function AssistedLivePage() {
  return (
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Phase 5</p>
        <h1>Assisted Live Trading</h1>
        <p className="lede">
          This phase adds an exchange adapter layer, a real Coinbase Advanced
          Trade path when configured, and an environment gate that blocks live
          submission unless explicitly enabled.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Execution Boundary</h2>
          <ul>
            <li>Preview first, then submit</li>
            <li>Server-side credentials only</li>
            <li>Trade-only permissions are expected</li>
            <li>Transfer permissions are treated as a red flag</li>
            <li>Live assisted execution requires explicit env enablement</li>
          </ul>
        </article>

        <article className="panel">
          <h2>Provider Strategy</h2>
          <ul>
            <li>Coinbase Advanced Trade is the real exchange path</li>
            <li>Mock provider remains the safe default in local and test flows</li>
            <li>Preview and submit attempts are recorded into the audit layer</li>
          </ul>
        </article>
      </section>

      <Phase5AssistedClient />

      <nav className="inline-nav">
        <Link href="/reports">Review reports</Link>
        <Link href="/operations">Open operations</Link>
        <Link href="/connect-exchange">Back to exchange setup</Link>
        <Link href="/">Return to overview</Link>
      </nav>
    </main>
  );
}
