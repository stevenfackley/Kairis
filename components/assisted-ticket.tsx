"use client";

import { useActionState, useEffect, useState } from "react";
import { previewAssistedAction, submitAssistedAction } from "@/app/app/trade/actions";
import { CUSTOM_PRODUCT, isWatchlistProduct } from "@/app/app/trade/order-form";
import { INITIAL_PREVIEW, INITIAL_SUBMIT, PREVIEW_TTL_SECONDS, type SubmitState } from "@/app/app/trade/state";
import { RiskDecisionView } from "@/components/risk-decision";
import { WATCHLIST } from "@/lib/domain/strategy";
import { describeSize } from "@/lib/exchange/sizing";
import type { OrderPreview } from "@/lib/exchange/types";
import { usd } from "@/lib/format";
import type { AssistedOrder, AssistedStatus, Side } from "@/lib/types";

type Provider = AssistedOrder["provider"];

type TicketProps = {
  provider: Provider;
  liveSubmitEnabled: boolean;
  defaultProduct: string;
  defaultSide: Side;
  defaultQuote: string;
  signalId: string | null;
};

const STATUS_PILL: Record<AssistedStatus, "pill-ok" | "pill-warn" | "pill-bad"> = {
  filled: "pill-ok",
  previewed: "pill-warn",
  submitted: "pill-warn",
  blocked: "pill-bad",
  failed: "pill-bad",
  cancelled: "pill-bad",
  expired: "pill-bad"
};

const STEPS = ["Check and preview", "Confirm", "Result"] as const;

/** Each order is one round; "Start another" remounts the round, which resets both action states. */
export function AssistedTicket(props: TicketProps) {
  const [round, setRound] = useState(0);
  return <TicketRound key={round} {...props} onReset={() => setRound((n) => n + 1)} />;
}

function money(n: number | null): string {
  return n === null ? "n/a" : usd(n);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Seconds left on a preview, counted from when this browser received it (the server is authoritative). */
function useSecondsLeft(previewKey: string | null): number {
  const [left, setLeft] = useState(PREVIEW_TTL_SECONDS);
  useEffect(() => {
    if (!previewKey) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const next = Math.max(0, PREVIEW_TTL_SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(next);
      if (next === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [previewKey]);
  return left;
}

function resultCopy(order: AssistedOrder): string {
  if (order.status === "submitted") {
    return order.provider === "coinbase"
      ? "Submitted. Reconcile to pull the fill from Coinbase."
      : "Submitted to the mock provider. Reconcile to pull the simulated fill.";
  }
  if (order.status === "blocked" || order.status === "failed") {
    return order.detail;
  }
  return `Status: ${order.status}. ${order.detail}`;
}

function PreviewPanel({ preview, order }: { preview: OrderPreview; order: AssistedOrder }) {
  const provider = order.provider;
  return (
    <section className="panel ticket-preview" aria-labelledby="ticket-preview-heading">
      <div className="panel-heading">
        <h3 id="ticket-preview-heading">Exchange preview</h3>
        <span className={`pill ${provider === "coinbase" ? "pill-warn" : "pill-ok"}`}>
          {provider === "coinbase" ? "Coinbase" : "Mock provider"}
        </span>
      </div>
      <div className="status-stack">
        {order.orderSize ? (
          <div className="status-row">
            <span>Order sent</span>
            <strong>{describeSize(order.orderSize, order.productId)}</strong>
          </div>
        ) : null}
        <div className="status-row">
          <span>Order total</span>
          <strong>{money(preview.orderTotal)}</strong>
        </div>
        <div className="status-row">
          <span>Commission</span>
          <strong>{money(preview.commissionTotal)}</strong>
        </div>
        <div className="status-row">
          <span>Best bid</span>
          <strong>{money(preview.bestBid)}</strong>
        </div>
        <div className="status-row">
          <span>Best ask</span>
          <strong>{money(preview.bestAsk)}</strong>
        </div>
      </div>
      {preview.warnings.length > 0 ? (
        <>
          <p className="field-label ticket-warnings-label">Warnings</p>
          <ul className="risk-reasons">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="field-help">The exchange returned no warnings.</p>
      )}
    </section>
  );
}

function ResultPanel({ state, onReset }: { state: Exclude<SubmitState, { step: "idle" }>; onReset: () => void }) {
  return (
    <section className="ticket-result" aria-live="polite">
      {state.step === "result" ? (
        <>
          <p className="ticket-summary">
            <span className={`pill ${STATUS_PILL[state.order.status]}`}>{state.order.status}</span>{" "}
            {state.order.side} {state.order.productId} {usd(state.order.quoteUsd)}
          </p>
          <p className={state.order.status === "submitted" || state.order.status === "filled" ? "success-copy" : "error-copy"} role="status">
            {resultCopy(state.order)}
          </p>
          {state.order.status === "blocked" && state.order.riskDecision ? (
            <RiskDecisionView decision={state.order.riskDecision} title="Risk checks at submit" />
          ) : null}
        </>
      ) : (
        <p className="error-copy" role="alert">
          {state.error}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="cta-secondary" onClick={onReset}>
          Start another
        </button>
      </div>
    </section>
  );
}

function TicketRound({ provider, liveSubmitEnabled, defaultProduct, defaultSide, defaultQuote, signalId, onReset }: TicketProps & { onReset: () => void }) {
  const [previewState, previewAction, previewing] = useActionState(previewAssistedAction, INITIAL_PREVIEW);
  const [submitState, submitAction, submitting] = useActionState(submitAssistedAction, INITIAL_SUBMIT);

  // Controlled: React 19 resets uncontrolled fields after an action, and a failed preview should keep the ticket.
  const startCustom = defaultProduct !== "" && !isWatchlistProduct(defaultProduct);
  const [product, setProduct] = useState<string>(startCustom ? CUSTOM_PRODUCT : defaultProduct || WATCHLIST[0]);
  const [customProduct, setCustomProduct] = useState(startCustom ? defaultProduct : "");
  const [side, setSide] = useState<Side>(defaultSide);
  const [quote, setQuote] = useState(defaultQuote);

  const previewed = previewState.step === "previewed" ? previewState : null;
  const secondsLeft = useSecondsLeft(previewed ? previewed.order.id : null);
  const expired = previewed !== null && secondsLeft === 0;

  const step = submitState.step !== "idle" ? 3 : previewState.step === "previewed" || previewState.step === "blocked" ? 2 : 1;
  const order = previewState.step === "previewed" || previewState.step === "blocked" ? previewState.order : null;

  return (
    <div className="ticket">
      <ol className="ticket-steps" aria-label="Assisted order steps">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
            <span className="ticket-step-number">{index + 1}</span> {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <form action={previewAction} className="ticket-form">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Product</span>
              <select name="productId" value={product} onChange={(event) => setProduct(event.target.value)} required>
                {WATCHLIST.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                <option value={CUSTOM_PRODUCT}>Other product…</option>
              </select>
            </label>
            {product === CUSTOM_PRODUCT ? (
              <label className="field">
                <span className="field-label">Custom product</span>
                <input
                  name="customProduct"
                  value={customProduct}
                  onChange={(event) => setCustomProduct(event.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AVAX-USD"
                  pattern="[A-Za-z0-9]{2,10}-[Uu][Ss][Dd]"
                />
                <span className="field-help">A USD pair on Coinbase, such as AVAX-USD.</span>
              </label>
            ) : null}
            <fieldset className="field">
              <legend className="field-label">Side</legend>
              <div className="button-row">
                <label className="check">
                  <input type="radio" name="side" value="BUY" checked={side === "BUY"} onChange={() => setSide("BUY")} required />
                  <span>Buy</span>
                </label>
                <label className="check">
                  <input type="radio" name="side" value="SELL" checked={side === "SELL"} onChange={() => setSide("SELL")} />
                  <span>Sell</span>
                </label>
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">Quote (USD)</span>
              <input
                name="quoteUsd"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="1000000"
                step="0.01"
                required
                value={quote}
                onChange={(event) => setQuote(event.target.value)}
              />
              <span className="field-help">
                A buy spends this many dollars, fees included. A sell converts the dollars to coins at the current price,
                rounded down to the coin&apos;s smallest step on Coinbase.
              </span>
            </label>
          </div>
          <input type="hidden" name="signalId" value={signalId ?? ""} />
          <p className="field-help">
            {provider === "coinbase"
              ? "The preview comes from your Coinbase account. Nothing is placed until you confirm in step 2."
              : "The preview comes from the mock provider. Nothing reaches an exchange."}
            {signalId ? " Linked to a signal; the order records it." : ""}
          </p>
          {previewState.step === "error" ? (
            <p className="error-copy" role="alert">
              {previewState.error}
            </p>
          ) : null}
          <div className="button-row">
            <button type="submit" className="cta-primary button-reset" disabled={previewing}>
              {previewing ? "Checking limits and previewing..." : "Check risk and preview"}
            </button>
          </div>
        </form>
      ) : null}

      {order ? (
        <p className="ticket-summary">
          {order.side} {order.productId} {usd(order.quoteUsd)} via {order.provider === "coinbase" ? "Coinbase" : "the mock provider"}
        </p>
      ) : null}

      {previewState.step === "previewed" || previewState.step === "blocked" ? (
        <RiskDecisionView decision={previewState.decision} />
      ) : null}

      {previewed ? <PreviewPanel preview={previewed.preview} order={previewed.order} /> : null}

      {step === 2 && previewState.step === "blocked" ? (
        <div className="button-row">
          <button type="button" className="cta-secondary" onClick={onReset}>
            Start another
          </button>
        </div>
      ) : null}

      {step === 2 && previewed ? (
        <form action={submitAction} className="ticket-form">
          <input type="hidden" name="orderId" value={previewed.order.id} />
          {previewed.order.provider === "coinbase" && !liveSubmitEnabled ? (
            <p className="error-copy">
              Live submission is disabled by environment policy. Submitting records a blocked attempt and sends nothing to
              Coinbase.
            </p>
          ) : null}
          <p className="field-help" role="timer" aria-live="off">
            Previews expire after 2 minutes.{" "}
            {expired ? "This preview has expired; start another to preview again." : `About ${clock(secondsLeft)} left.`}
          </p>
          <label className="check">
            <input type="checkbox" name="confirm" value="yes" required disabled={expired} />
            <span>I reviewed the risk checks and the exchange preview. Submit this order.</span>
          </label>
          <div className="button-row">
            <button type="submit" className="cta-primary button-reset" disabled={submitting || expired}>
              {submitting ? "Submitting..." : "Submit to exchange"}
            </button>
            <button type="button" className="cta-secondary" onClick={onReset} disabled={submitting}>
              Start another
            </button>
          </div>
        </form>
      ) : null}

      {submitState.step !== "idle" ? <ResultPanel state={submitState} onReset={onReset} /> : null}
    </div>
  );
}
