import type { Metadata } from "next";
import { createExportAction } from "@/app/app/reports/actions";
import { when } from "@/lib/format";
import { firstString } from "@/lib/search-params";
import { listExports } from "@/lib/server/repos/exports";
import { EXPORT_LABEL, EXPORT_ROW_LIMIT } from "@/lib/server/services/exports";
import { requireOnboarded } from "@/lib/server/session";
import type { ExportType } from "@/lib/types";

export const metadata: Metadata = { title: "Exports | Kairis" };

const BUTTONS: ReadonlyArray<{ type: ExportType; label: string }> = [
  { type: "paper-journal", label: "Export paper journal" },
  { type: "assisted-orders", label: "Export assisted orders" },
  { type: "audit-log", label: "Export audit log" }
];

const downloadHref = (id: string) => `/app/reports/download/${encodeURIComponent(id)}`;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboarded("/app/reports");
  const sp = await searchParams;
  const error = firstString(sp, "error");
  const createdId = firstString(sp, "created");
  const exports = await listExports(user.id);
  const created = createdId ? exports.find((x) => x.id === createdId) : undefined;

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Reports</p>
        <h1>Exports</h1>
        <p className="lede">
          CSV exports of your paper journal (fills, fees and realized P&amp;L), assisted orders and audit log, newest first,
          up to {EXPORT_ROW_LIMIT.toLocaleString("en-US")} rows each. Only you can download your exports.
        </p>
      </header>

      <section className="panel" aria-labelledby="new-heading">
        <h2 id="new-heading">New export</h2>
        {error ? (
          <p className="error-copy" role="alert">
            {error}
          </p>
        ) : null}
        {created ? (
          <p className="success-copy" role="status">
            {EXPORT_LABEL[created.type]} export created. <a href={downloadHref(created.id)}>Download it now</a> or from the list
            below.
          </p>
        ) : null}
        <div className="button-row">
          {BUTTONS.map((b) => (
            <form action={createExportAction} key={b.type}>
              <input type="hidden" name="type" value={b.type} />
              <button type="submit" className="cta-secondary">
                {b.label}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="past-heading">
        <h2 id="past-heading">Past exports</h2>
        {exports.length === 0 ? (
          <p className="empty">No exports yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Stored in</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((x) => (
                  <tr key={x.id}>
                    <td>{when(x.createdAt)}</td>
                    <td>{EXPORT_LABEL[x.type]}</td>
                    <td>
                      <span className={`pill ${x.storage === "r2" ? "pill-ok" : "pill-warn"}`}>{x.storage === "r2" ? "R2" : "Server disk"}</span>
                    </td>
                    <td>
                      <a href={downloadHref(x.id)}>Download CSV</a>
                    </td>
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
