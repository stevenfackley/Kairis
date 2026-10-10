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
        <span className="field-label">API key id</span>
        <input name="keyId" required autoComplete="off" spellCheck={false} placeholder="Key id or organizations/…/apiKeys/…" />
        <span className="field-help">
          Ed25519 key (the Coinbase default): the &quot;id&quot; value from the downloaded key file. ECDSA key: the full
          &quot;name&quot; value, shaped like organizations/…/apiKeys/….
        </span>
      </label>
      <label className="field">
        <span className="field-label">Private key</span>
        <textarea name="secretPem" required autoComplete="off" spellCheck={false} rows={6} />
        <span className="field-help">
          The &quot;privateKey&quot; value from the same file: a single base64 line for an Ed25519 key, or the whole block from
          -----BEGIN EC PRIVATE KEY----- to -----END EC PRIVATE KEY----- for an ECDSA key. Pasting it with the \n escapes from
          the file is fine.
        </span>
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
