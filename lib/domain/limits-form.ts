import type { ExecutionMode, TradingLimits } from "@/lib/types";

/** Modes a user can pick for themselves. Auto is owner-only and never offered. */
export type PublicMode = Extract<ExecutionMode, "paper" | "manual" | "assisted">;
export const PUBLIC_MODES: readonly PublicMode[] = ["paper", "manual", "assisted"];

/** The "Preferred mode" field on the Controls page. */
export function parsePreferredMode(form: FormData): { ok: true; mode: PublicMode } | { ok: false; error: string } {
  const value = form.get("preferredMode");
  const mode = PUBLIC_MODES.find((m) => m === value);
  return mode ? { ok: true, mode } : { ok: false, error: "Choose a preferred mode: paper, manual or assisted." };
}

/** `tradingPaused` undefined means "leave the stored pause as it is". */
export type LimitsInput = Omit<TradingLimits, "userId" | "updatedAt" | "tradingPaused"> & { tradingPaused?: boolean };
export type LimitsFormResult = { ok: true; limits: LimitsInput } | { ok: false; error: string };

const PRODUCT_RE = /^[A-Z0-9]{2,10}-USD$/;
// Plain decimal only: no exponent, hex, Infinity or thousands separators.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;
// Upper bounds keep values inside their columns (numeric(12,2), integer) and inside reason.
const MAX_USD = 10_000_000;
const MAX_TRADES_PER_DAY = 1000;
const MAX_COOLDOWN_MINUTES = 10_080; // one week
const MAX_LOSS_STREAK = 100;
const MAX_CAP_ROWS = 20;

class LimitsFormError extends Error {}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function textAt(values: FormDataEntryValue[], index: number): string {
  const value = values[index];
  return typeof value === "string" ? value.trim() : "";
}

function positive(raw: string, label: string): number {
  if (raw === "") {
    throw new LimitsFormError(`${label} is required.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new LimitsFormError(`${label} must be a number.`);
  }
  if (!DECIMAL.test(raw)) {
    throw new LimitsFormError(`${label} must be a plain number, such as 300 or 250.50.`);
  }
  if (value <= 0) {
    throw new LimitsFormError(`${label} must be greater than 0.`);
  }
  return value;
}

// Whole cents only: a value is stored exactly as typed, never silently rounded.
function cents(raw: string, value: number, label: string): number {
  if ((raw.split(".")[1] ?? "").replace(/0+$/, "").length > 2) {
    throw new LimitsFormError(`${label} can have at most two decimal places (whole cents).`);
  }
  return Math.round(value * 100) / 100;
}

function money(form: FormData, name: string, label: string): number {
  const raw = text(form, name);
  const value = positive(raw, label);
  if (value > MAX_USD) {
    throw new LimitsFormError(`${label} must be at most $10,000,000.`);
  }
  return cents(raw, value, label);
}

function whole(form: FormData, name: string, label: string, max: number): number {
  const value = positive(text(form, name), label);
  if (!Number.isInteger(value)) {
    throw new LimitsFormError(`${label} must be a whole number.`);
  }
  if (value > max) {
    throw new LimitsFormError(`${label} must be at most ${max.toLocaleString("en-US")}.`);
  }
  return value;
}

// Rows pair capProduct[i] with capUsd[i]; a row with both cells blank is ignored.
function caps(form: FormData, maxPositionUsd: number): Record<string, number> {
  const products = form.getAll("capProduct");
  const amounts = form.getAll("capUsd");
  const rows = Math.max(products.length, amounts.length);
  const result: Record<string, number> = {};
  let used = 0;
  for (let i = 0; i < rows; i += 1) {
    const rawProduct = textAt(products, i);
    const rawCap = textAt(amounts, i);
    if (rawProduct === "" && rawCap === "") {
      continue;
    }
    used += 1;
    if (used > MAX_CAP_ROWS) {
      throw new LimitsFormError(`At most ${MAX_CAP_ROWS} per-symbol caps can be set.`);
    }
    if (rawProduct === "") {
      throw new LimitsFormError("A per-symbol cap has no product. Enter a product such as SOL-USD or clear the row.");
    }
    const product = rawProduct.toUpperCase();
    if (!PRODUCT_RE.test(product)) {
      throw new LimitsFormError(`"${rawProduct}" is not a product such as SOL-USD.`);
    }
    if (result[product] !== undefined) {
      throw new LimitsFormError(`${product} has more than one cap. Keep one row per product.`);
    }
    const cap = cents(rawCap, positive(rawCap, `The ${product} cap`), `The ${product} cap`);
    if (cap > maxPositionUsd) {
      throw new LimitsFormError(`The ${product} cap cannot be larger than the max position.`);
    }
    result[product] = cap;
  }
  return result;
}

function checked(form: FormData, name: string): boolean {
  const value = text(form, name).toLowerCase();
  return value === "on" || value === "true" || value === "yes";
}

/**
 * The pause is the kill switch's job; saving limits only changes it when the user ticked or cleared the
 * box on this form. `pausedWas` is the stored state the form was rendered with: when the box still
 * matches it, the stored pause is left alone (so a pause set from the dashboard after the form loaded
 * survives a limits save). Without `pausedWas` a ticked box still pauses, but nothing resumes.
 */
function pauseChange(form: FormData): boolean | undefined {
  const wants = checked(form, "tradingPaused");
  const was = text(form, "pausedWas").toLowerCase();
  if (was !== "true" && was !== "false") {
    return wants ? true : undefined;
  }
  return wants === (was === "true") ? undefined : wants;
}

/**
 * Server-side validation for the limits form. Every number must be a plain decimal above 0; money has at
 * most two decimals; trade count, cooldown and loss streak are whole numbers; a per-symbol cap may not
 * exceed the max position. The daily loss cap is independent of the max position. Returns the first
 * problem in plain language.
 */
export function parseLimitsForm(form: FormData): LimitsFormResult {
  try {
    const maxPositionUsd = money(form, "maxPositionUsd", "Max position");
    const dailyLossCapUsd = money(form, "dailyLossCapUsd", "Daily loss cap");
    const maxTradesPerDay = whole(form, "maxTradesPerDay", "Max trades per day", MAX_TRADES_PER_DAY);
    const cooldownMinutes = whole(form, "cooldownMinutes", "Cooldown minutes", MAX_COOLDOWN_MINUTES);
    const lossStreakTrigger = whole(form, "lossStreakTrigger", "Loss streak trigger", MAX_LOSS_STREAK);
    const perSymbolMaxUsd = caps(form, maxPositionUsd);
    return {
      ok: true,
      limits: {
        maxPositionUsd,
        dailyLossCapUsd,
        maxTradesPerDay,
        cooldownMinutes,
        lossStreakTrigger,
        perSymbolMaxUsd,
        tradingPaused: pauseChange(form)
      }
    };
  } catch (error) {
    if (error instanceof LimitsFormError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
