import type { TradingLimits } from "@/lib/types";

export type LimitsInput = Omit<TradingLimits, "userId" | "updatedAt">;
export type LimitsFormResult = { ok: true; limits: LimitsInput } | { ok: false; error: string };

const PRODUCT_RE = /^[A-Z0-9]{2,10}-USD$/;
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
  if (value <= 0) {
    throw new LimitsFormError(`${label} must be greater than 0.`);
  }
  return value;
}

function money(form: FormData, name: string, label: string): number {
  const value = positive(text(form, name), label);
  if (value > MAX_USD) {
    throw new LimitsFormError(`${label} must be at most $10,000,000.`);
  }
  return Math.round(value * 100) / 100;
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
    const cap = positive(rawCap, `The ${product} cap`);
    if (cap > maxPositionUsd) {
      throw new LimitsFormError(`The ${product} cap cannot be larger than the max position.`);
    }
    result[product] = Math.round(cap * 100) / 100;
  }
  return result;
}

function checked(form: FormData, name: string): boolean {
  const value = text(form, name).toLowerCase();
  return value === "on" || value === "true" || value === "yes";
}

/**
 * Server-side validation for the limits form. Every number must be finite and above 0; trade count,
 * cooldown and loss streak are whole numbers; a per-symbol cap may not exceed the max position. The
 * daily loss cap is independent of the max position. Returns the first problem in plain language.
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
        tradingPaused: checked(form, "tradingPaused")
      }
    };
  } catch (error) {
    if (error instanceof LimitsFormError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
