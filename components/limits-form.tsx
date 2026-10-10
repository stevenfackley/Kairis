"use client";

import { useActionState, useState } from "react";
import { saveLimitsAction, type LimitsFormState } from "@/app/app/controls/actions";
import type { TradingLimits } from "@/lib/types";

type NumberField = "maxPositionUsd" | "dailyLossCapUsd" | "maxTradesPerDay" | "cooldownMinutes" | "lossStreakTrigger";
type Values = Record<NumberField, string>;
type CapRow = { product: string; usd: string };

const MIN_CAP_ROWS = 5;

const FIELDS: Array<{ name: NumberField; label: string; help: string; step: string; min: string }> = [
  {
    name: "maxPositionUsd",
    label: "Max position (USD)",
    help: "The most one product can hold once an order fills, counting what you already hold.",
    step: "0.01",
    min: "0.01"
  },
  {
    name: "dailyLossCapUsd",
    label: "Daily loss cap (USD)",
    help: "When today's realized losses reach this amount, new orders wait until the next UTC day.",
    step: "0.01",
    min: "0.01"
  },
  {
    name: "maxTradesPerDay",
    label: "Max trades per day",
    help: "Orders allowed per UTC day, counted separately for paper and live.",
    step: "1",
    min: "1"
  },
  {
    name: "cooldownMinutes",
    label: "Cooldown minutes after a loss streak",
    help: "How long new orders wait after the last loss in a streak.",
    step: "1",
    min: "1"
  },
  {
    name: "lossStreakTrigger",
    label: "Loss streak trigger",
    help: "Losing sells in a row that start the cooldown.",
    step: "1",
    min: "1"
  }
];

const INITIAL: LimitsFormState = { error: null, saved: false };

function toValues(limits: TradingLimits): Values {
  return {
    maxPositionUsd: String(limits.maxPositionUsd),
    dailyLossCapUsd: String(limits.dailyLossCapUsd),
    maxTradesPerDay: String(limits.maxTradesPerDay),
    cooldownMinutes: String(limits.cooldownMinutes),
    lossStreakTrigger: String(limits.lossStreakTrigger)
  };
}

function toRows(limits: TradingLimits): CapRow[] {
  const rows = Object.entries(limits.perSymbolMaxUsd)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, cap]) => ({ product, usd: String(cap) }));
  while (rows.length < MIN_CAP_ROWS) rows.push({ product: "", usd: "" });
  return rows;
}

// Everything stored except updatedAt, which is "now" on every render for a user with no saved row.
function signature(limits: TradingLimits): string {
  return JSON.stringify([toValues(limits), limits.perSymbolMaxUsd, limits.tradingPaused]);
}

/**
 * Controlled on purpose: React 19 resets uncontrolled fields after a form action, and a validation
 * error must not wipe what was typed. When the stored limits change (a save, or the kill switch on
 * this page), the fields re-sync to what is stored.
 */
export function LimitsForm({ limits }: { limits: TradingLimits }) {
  const [state, formAction, pending] = useActionState(saveLimitsAction, INITIAL);
  const [values, setValues] = useState<Values>(() => toValues(limits));
  const [rows, setRows] = useState<CapRow[]>(() => toRows(limits));
  const [paused, setPaused] = useState(limits.tradingPaused);
  const [synced, setSynced] = useState(() => signature(limits));

  const stored = signature(limits);
  if (stored !== synced) {
    setSynced(stored);
    setValues(toValues(limits));
    setRows(toRows(limits));
    setPaused(limits.tradingPaused);
  }

  const setRow = (index: number, patch: Partial<CapRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="limits-form">
      <div className="form-grid">
        {FIELDS.map((field) => (
          <label className="field" key={field.name}>
            <span className="field-label">{field.label}</span>
            <input
              name={field.name}
              type="number"
              inputMode={field.step === "1" ? "numeric" : "decimal"}
              min={field.min}
              step={field.step}
              required
              value={values[field.name]}
              onChange={(event) => {
                const next = event.target.value;
                setValues((current) => ({ ...current, [field.name]: next }));
              }}
            />
            <span className="field-help">{field.help}</span>
          </label>
        ))}
      </div>

      <fieldset className="field">
        <legend className="field-label">Per-symbol caps</legend>
        <span className="field-help">
          Optional. A tighter max position for one product, for example SOL-USD at $200. It cannot be larger than the max
          position. Leave a row blank to skip it.
        </span>
        {rows.map((row, index) => (
          <div className="limits-cap-row" key={index}>
            <input
              name="capProduct"
              aria-label={`Product, cap row ${index + 1}`}
              placeholder="SOL-USD"
              autoComplete="off"
              spellCheck={false}
              value={row.product}
              onChange={(event) => setRow(index, { product: event.target.value })}
            />
            <input
              name="capUsd"
              aria-label={`Cap in USD, cap row ${index + 1}`}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="200"
              value={row.usd}
              onChange={(event) => setRow(index, { usd: event.target.value })}
            />
          </div>
        ))}
      </fieldset>

      <label className="check">
        <input type="checkbox" name="tradingPaused" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
        <span>
          <strong>Pause all trading (kill switch)</strong>. While paused, no new paper or live order can be placed.
        </span>
      </label>

      {state.error ? (
        <p className="error-copy" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved && !pending ? (
        <p className="success-copy" role="status">
          Limits saved
        </p>
      ) : null}

      <div className="button-row">
        <button type="submit" className="cta-primary button-reset" disabled={pending}>
          {pending ? "Saving..." : "Save limits"}
        </button>
      </div>
    </form>
  );
}
