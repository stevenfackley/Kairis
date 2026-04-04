"use client";

import { useState, useTransition } from "react";
import type { AssistedOrderPreview } from "@/lib/types";

type ProviderStatus = {
  provider: "coinbase" | "mock";
  canView: boolean;
  canTrade: boolean;
  canTransfer: boolean;
  detail: string;
  assistedLiveTradingEnabled: boolean;
};

type SubmitResult = {
  success: boolean;
  orderId?: string;
  clientOrderId?: string;
  detail?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }

  return payload;
}

export function Phase5AssistedClient() {
  const [isPending, startTransition] = useTransition();
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [preview, setPreview] = useState<AssistedOrderPreview | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = {
    productId: "BTC-USD",
    side: "BUY" as const,
    quoteSize: 25
  };

  const loadProviderStatus = () => {
    startTransition(async () => {
      try {
        setError(null);
        setProviderStatus(await getJson<ProviderStatus>("/api/phase5/provider-status"));
      } catch (statusError) {
        setError(statusError instanceof Error ? statusError.message : "Unable to load provider status.");
      }
    });
  };

  const previewOrder = () => {
    startTransition(async () => {
      try {
        setError(null);
        setSubmitResult(null);
        setPreview(await postJson<AssistedOrderPreview>("/api/phase5/preview-order", payload));
      } catch (previewError) {
        setError(previewError instanceof Error ? previewError.message : "Unable to preview order.");
      }
    });
  };

  const submitOrder = () => {
    startTransition(async () => {
      try {
        setError(null);
        setSubmitResult(
          await postJson<SubmitResult>("/api/phase5/submit-order", {
            ...payload,
            previewId: preview?.previewId
          })
        );
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unable to submit order.");
      }
    });
  };

  return (
    <section className="phase4-stack">
      <div className="phase4-actions">
        <button className="cta-secondary button-reset" onClick={loadProviderStatus} type="button">
          Check provider status
        </button>
        <button className="cta-primary button-reset" onClick={previewOrder} type="button">
          Preview assisted order
        </button>
        <button
          className="cta-secondary button-reset"
          disabled={!preview}
          onClick={submitOrder}
          type="button"
        >
          Submit assisted order
        </button>
      </div>

      {isPending ? <p className="panel-copy">Running assisted execution flow…</p> : null}
      {error ? <p className="error-copy">{error}</p> : null}

      {providerStatus ? (
        <article className="panel">
          <p className="eyebrow">Provider Status</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Provider</span>
              <strong>{providerStatus.provider}</strong>
            </div>
            <div className="status-row">
              <span>View permission</span>
              <strong>{providerStatus.canView ? "Yes" : "No"}</strong>
            </div>
            <div className="status-row">
              <span>Trade permission</span>
              <strong>{providerStatus.canTrade ? "Yes" : "No"}</strong>
            </div>
            <div className="status-row">
              <span>Transfer permission</span>
              <strong>{providerStatus.canTransfer ? "Yes" : "No"}</strong>
            </div>
            <div className="status-row">
              <span>Assisted live enabled</span>
              <strong>{providerStatus.assistedLiveTradingEnabled ? "Yes" : "No"}</strong>
            </div>
          </div>
          <p className="panel-copy provider-detail">{providerStatus.detail}</p>
        </article>
      ) : null}

      {preview ? (
        <article className="panel">
          <p className="eyebrow">Order Preview</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Product</span>
              <strong>{preview.productId}</strong>
            </div>
            <div className="status-row">
              <span>Side</span>
              <strong>{preview.side}</strong>
            </div>
            <div className="status-row">
              <span>Quote size</span>
              <strong>${preview.quoteSize}</strong>
            </div>
            <div className="status-row">
              <span>Estimated price</span>
              <strong>
                {preview.estimatedPrice > 0 ? `$${preview.estimatedPrice}` : "Not returned"}
              </strong>
            </div>
            <div className="status-row">
              <span>Commission</span>
              <strong>${preview.commissionTotal}</strong>
            </div>
          </div>

          {preview.warnings.length > 0 ? (
            <ul>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}

      {submitResult ? (
        <article className="panel">
          <p className="eyebrow">Submission Result</p>
          <div className="status-stack">
            <div className="status-row">
              <span>Accepted</span>
              <strong>{submitResult.success ? "Yes" : "No"}</strong>
            </div>
            <div className="status-row">
              <span>Order ID</span>
              <strong>{submitResult.orderId || "N/A"}</strong>
            </div>
            <div className="status-row">
              <span>Client order ID</span>
              <strong>{submitResult.clientOrderId || "N/A"}</strong>
            </div>
          </div>
          <p className="panel-copy provider-detail">{submitResult.detail}</p>
        </article>
      ) : null}
    </section>
  );
}
