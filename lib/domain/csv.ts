export type CsvCell = string | number | boolean | null | undefined;

const PURE_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
// OWASP CSV injection: a cell starting with one of these may be run as a formula by a spreadsheet.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Plain decimal text for a number: no exponent ("1.2e-7"), no grouping, no currency. */
function numberText(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  return /e/i.test(s) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : s;
}

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? numberText(v) : String(v);
  if (typeof v === "string" && FORMULA_START.test(s) && !PURE_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** RFC 4180-style CSV: quoted where needed, formula-looking text neutralized, numbers unformatted. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}
