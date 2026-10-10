// numeric(12,2) money columns: an absurd or non-finite size still has to persist on a blocked row.
const MAX_STORABLE_USD = 9_999_999_999.99;

export function storableUsd(n: number): number {
  return Number.isFinite(n) && Math.abs(n) <= MAX_STORABLE_USD ? n : 0;
}

export function errorMessage(error: unknown, fallback = "Unknown error."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
