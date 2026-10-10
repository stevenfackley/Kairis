"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { placePaperOrderAction } from "@/app/app/paper/actions";
import { INITIAL_PAPER_TICKET_STATE, type PaperTicketState } from "@/app/app/paper/state";
import { RiskDecisionView } from "@/components/risk-decision";
import { CUSTOM_PRODUCT, MAX_NOTE_LENGTH, MAX_TICKET_USD, SELL_ALL_INTENT } from "@/lib/domain/order-form";
import { usdPrice } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";

type PaperTicketProps = {
  defaults: { productId?: string; quoteUsd?: number; signalId?: string };
  watchlist: readonly string[];
  /** Held base size per product, for the "Sell entire position" button. */
  holdings: Record<string, number>;
};

type Result = NonNullable<PaperTicketState["result"]>;

function resultLine({ trade, decision }: Result): string {
  if (trade.status === "filled") {
    const verb = trade.side === "BUY" ? "bought" : "sold";
    const fee = ` Fee ${usd(trade.feeUsd ?? 0)}.`;
    const pnl = trade.side === "SELL" ? ` Realized ${usd(trade.realizedPnlUsd)} after fees.` : "";
    return `Filled: ${verb} ${num(trade.baseSize, 8)} ${trade.productId} at ${usdPrice(trade.price)}.${fee}${pnl}`;
  }
  const label = decision.outcome === "halted" ? "Halted" : "Blocked";
  return `${label}: ${decision.reasons[0] ?? "a risk check failed."} Nothing was filled; the attempt is in your journal.`;
}

export function PaperTicket({ defaults, watchlist, holdings }: PaperTicketProps) {
  const [state, formAction, pending] = useActionState(placePaperOrderAction, INITIAL_PAPER_TICKET_STATE);
  const preset = defaults.productId;
  const [choice, setChoice] = useState(() =>
    preset && watchlist.includes(preset) ? preset : preset ? CUSTOM_PRODUCT : (watchlist[0] ?? CUSTOM_PRODUCT)
  );
  const [customProduct, setCustomProduct] = useState(() => (preset && !watchlist.includes(preset) ? preset : ""));
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quoteUsd, setQuoteUsd] = useState(() => (defaults.quoteUsd ? defaults.quoteUsd.toFixed(2) : ""));
  const [note, setNote] = useState("");

  const productId = choice === CUSTOM_PRODUCT ? customProduct.trim().toUpperCase() : choice;
  // The signal link only describes the product it was opened for; switching product drops it.
  const signalId = defaults.signalId && productId === preset ? defaults.signalId : "";
  const heldSize = holdings[productId];

  // Dispatch manually so React does not auto-reset the form after the action: the fields are
  // controlled, and a DOM reset would desync the product select from state. Before hydration the
  // form still posts through `action`.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The submitter carries intent=sell-all when "Sell entire position" was pressed.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="paper-ticket">
      <form action={formAction} onSubmit={onSubmit} className="form-grid">
        <label className="field">
          <span className="field-label">Product</span>
          <select name="product" value={choice} onChange={(e) => setChoice(e.target.value)} required>
            {watchlist.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            <option value={CUSTOM_PRODUCT}>Custom…</option>
          </select>
        </label>

        {choice === CUSTOM_PRODUCT ? (
          <label className="field">
            <span className="field-label">Custom product</span>
            <input
              name="customProduct"
              value={customProduct}
              onChange={(e) => setCustomProduct(e.target.value)}
              placeholder="AVAX-USD"
              pattern="[A-Za-z0-9]{2,10}-[Uu][Ss][Dd]"
              title="A Coinbase USD pair, such as AVAX-USD."
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="field-help">Any Coinbase spot pair quoted in USD.</span>
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
          <span className="field-label">Size (USD)</span>
          <input
            name="quoteUsd"
            type="number"
            inputMode="decimal"
            min="0.01"
            max={MAX_TICKET_USD}
            step="0.01"
            value={quoteUsd}
            onChange={(e) => setQuoteUsd(e.target.value)}
            required
          />
          <span className="field-help">
            A sell is sized in dollars too, up to what you hold. To close a position exactly, use Sell entire position.
          </span>
        </label>

        <label className="field paper-ticket-note">
          <span className="field-label">Note (optional)</span>
          <textarea name="note" maxLength={MAX_NOTE_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="field-help">
            {note.length} of {MAX_NOTE_LENGTH} characters. Why you are taking the trade, for your journal.
          </span>
        </label>

        <input type="hidden" name="signalId" value={signalId} />

        <div className="button-row paper-ticket-submit">
          <button type="submit" className="cta-primary button-reset" disabled={pending}>
            {pending ? "Checking limits..." : "Place paper order"}
          </button>
          <button
            type="submit"
            name="intent"
            value={SELL_ALL_INTENT}
            formNoValidate
            className="cta-secondary button-reset"
            disabled={pending || heldSize === undefined}
            title={heldSize === undefined ? `You hold no ${productId || "position"} in paper.` : undefined}
          >
            {heldSize === undefined ? "Sell entire position" : `Sell entire position (${num(heldSize, 8)} ${productId.split("-")[0]})`}
          </button>
          <span className="field-help">
            {signalId ? "Linked to the signal you opened. " : ""}
            Your limits are checked before anything fills.
          </span>
        </div>
      </form>

      {state.error ? (
        <p className="error-copy" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.result ? (
        <div className="paper-ticket-result">
          <p className={state.result.trade.status === "filled" ? "success-copy" : "error-copy"} role="status">
            {resultLine(state.result)}
          </p>
          <RiskDecisionView decision={state.result.decision} />
        </div>
      ) : null}
    </div>
  );
}
