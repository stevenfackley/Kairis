import type { Metadata } from "next";
import Link from "next/link";
import { when } from "@/lib/format";
import { firstString, oneOf } from "@/lib/search-params";
import { listAudit } from "@/lib/server/repos/audit";
import { requireOnboarded } from "@/lib/server/session";
import type { AuditCategory } from "@/lib/types";

export const metadata: Metadata = { title: "Journal | Kairis" };

const CATEGORIES = [
  "auth",
  "onboarding",
  "limits",
  "signal",
  "risk",
  "paper-trade",
  "assisted-order",
  "exchange",
  "export",
  "operations",
  "auto"
] as const satisfies readonly AuditCategory[];
const LIMITS = ["50", "200", "500"] as const;

const PILL: Partial<Record<AuditCategory, string>> = {
  risk: "pill-warn",
  "assisted-order": "pill-warn",
  auto: "pill-warn",
  "paper-trade": "pill-ok",
  export: "pill-ok"
};

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboarded("/app/journal");
  const sp = await searchParams;
  const category = oneOf(firstString(sp, "category"), CATEGORIES);
  const limit = Number(oneOf(firstString(sp, "limit"), LIMITS) ?? "200");
  const events = await listAudit(user.id, { category: category ?? undefined, limit });

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Records</p>
        <h1>Journal</h1>
        <p className="lede">Every signal evaluation, risk decision, order attempt and setting change, in order. Nothing here is editable.</p>
      </header>

      <section className="panel" aria-labelledby="filter-heading">
        <div className="panel-heading">
          <h2 id="filter-heading">Filter</h2>
          <Link className="inline-link" href="/app/reports">
            Export the full audit log (Reports)
          </Link>
        </div>
        <form method="get" className="form-grid">
          <label className="field">
            <span className="field-label">Category</span>
            <select name="category" defaultValue={category ?? ""}>
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Show</span>
            <select name="limit" defaultValue={String(limit)}>
              {LIMITS.map((l) => (
                <option key={l} value={l}>
                  Latest {l}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button type="submit" className="cta-secondary">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="panel" aria-labelledby="log-heading">
        <h2 id="log-heading">Events</h2>
        {events.length === 0 ? (
          <p className="empty">{category ? `No ${category} events yet.` : "No events yet. Actions you take will appear here."}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.createdAt)}</td>
                    <td>
                      <span className={`pill ${PILL[e.category] ?? ""}`.trim()}>{e.category}</span>
                    </td>
                    <td>{e.action}</td>
                    <td>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
