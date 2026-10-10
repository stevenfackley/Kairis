// Price text that lib/format's usd() (always 2 decimals) cannot give. Pure: safe in client components.

/**
 * A price: $1,234.56 from $1 up, and up to 8 decimals below $1, so a micro-priced coin ($0.00001234)
 * never reads as $0.00.
 */
export function usdPrice(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) >= 1 ? 2 : 8 });
}
