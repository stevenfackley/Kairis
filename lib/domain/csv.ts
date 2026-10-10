export type CsvCell = string | number | boolean | null | undefined;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}
