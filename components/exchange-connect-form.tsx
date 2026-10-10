"use client";

import { useActionState } from "react";
import { connectExchangeAction, type ExchangeFormState } from "@/app/app/exchange/actions";

const INITIAL: ExchangeFormState = { error: null, connected: false };

/**
 * Uncontrolled on purpose: React 19 resets the form after each attempt, so the pasted private key
 * does not linger in the page after a failed validation.
 */
export function ExchangeConnectForm() {
  const [state, formAction, pending] = useActionState(connectExchangeAction, INITIAL);
  return (
    <form action={formAction} className="exchange-form">
      <label className="field">
        <span className="field-label">API key name</span>
        <input name="keyId" required autoComplete="off" spellCheck={false} placeholder="organizations/.../apiKeys/..." />
        <span className="field-help">The &quot;name&quot; value from the downloaded JSON, shaped like organizations/…/apiKeys/….</span>
      </label>
      <label className="field">
        <span className="field-label">Private key</span>
        <textarea name="secretPem" required autoComplete="off" spellCheck={false} rows={6} />
        <span className="field-help">The EC private key from the downloaded JSON, including the BEGIN/END lines.</span>
      </label>
      {state.error ? (
        <p className="error-copy" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.connected ? (
        <p className="success-copy" role="status">
          Connected. Kairis verified the key with Coinbase.
        </p>
      ) : null}
      <div className="button-row">
        <button type="submit" className="cta-primary button-reset" disabled={pending}>
          {pending ? "Validating with Coinbase..." : "Validate and connect"}
        </button>
      </div>
    </form>
  );
}
