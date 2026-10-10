import type { RiskCheck, RiskDecision, RiskOutcome } from "@/lib/types";

// Shared row -> domain converters. pg returns numeric as string, timestamptz as Date,
// and json/jsonb already parsed (but untyped), so every jsonb value is narrowed here.

export type Timestamp = Date | string;
export type Numeric = string | number;

export function toIso(value: Timestamp): string {
  return new Date(value).toISOString();
}

export function toIsoOrNull(value: Timestamp | null): string | null {
  return value === null ? null : toIso(value);
}

export function toNumber(value: Numeric): number {
  return Number(value);
}

export function toNumberOrNull(value: Numeric | null): number | null {
  return value === null ? null : Number(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RISK_OUTCOMES: readonly string[] = ["approved", "blocked", "halted"];

function isRiskOutcome(value: unknown): value is RiskOutcome {
  return typeof value === "string" && RISK_OUTCOMES.includes(value);
}

function isRiskCheck(value: unknown): value is RiskCheck {
  return isRecord(value) && typeof value.code === "string" && typeof value.passed === "boolean" && typeof value.detail === "string";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function toRiskDecision(value: unknown): RiskDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  const { outcome, checks, reasons, evaluatedAt } = value;
  if (!isRiskOutcome(outcome) || typeof evaluatedAt !== "string" || !Array.isArray(checks) || !Array.isArray(reasons)) {
    return null;
  }
  return { outcome, checks: checks.filter(isRiskCheck), reasons: reasons.filter(isString), evaluatedAt };
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

export function toNumberRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) {
    return out;
  }
  for (const [key, raw] of Object.entries(value)) {
    const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(num)) {
      out[key] = num;
    }
  }
  return out;
}

/**
 * A value for a numeric(p,s) column whose integer part holds at most `maxAbs`: non-finite becomes null,
 * anything larger is clamped to the column's limit, so an insert never fails with "numeric field
 * overflow" and NaN or Infinity never reaches the database.
 */
export function toNumericParam(value: number | null, maxAbs: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

// jsonb params go over the wire as JSON text: pg would otherwise turn JS arrays into Postgres arrays.
export function toJsonParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// An empty id/createdAt on insert lets the database assign gen_random_uuid() / now().
export function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}
