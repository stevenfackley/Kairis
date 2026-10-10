// Display formatting shared by server and client components. Pure: no locale or timezone leaks,
// so the server render and the browser hydrate to identical text.

const MISSING = "n/a";

function finite(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

export function usd(n: number, dp = 2): string {
  if (!finite(n)) return MISSING;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function num(n: number, dp = 4): string {
  if (!finite(n)) return MISSING;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

/** `n` is already in percent units (1.5 means 1.5%). */
export function pct(n: number, dp = 2): string {
  if (!finite(n)) return MISSING;
  return `${n.toFixed(dp)}%`;
}

const WHEN_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** UTC date-time at minute precision, e.g. "Oct 9, 2026, 12:34 UTC". */
export function when(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return MISSING;
  return `${WHEN_FORMAT.format(date)} UTC`;
}

export function short(id: string): string {
  return id.slice(0, 8);
}
