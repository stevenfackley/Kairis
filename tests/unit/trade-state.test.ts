import { describe, expect, it } from "vitest";
import { freshestOrder, ticketStep, type PreviewState, type SubmitState } from "@/app/app/trade/state";
import type { AssistedOrder, RiskDecision } from "@/lib/types";

const decision: RiskDecision = { outcome: "approved", checks: [], reasons: [], evaluatedAt: "2026-10-10T12:00:00.000Z" };

function order(overrides: Partial<AssistedOrder> = {}): AssistedOrder {
  return {
    id: "o-1",
    userId: "u",
    productId: "BTC-USD",
    side: "BUY",
    quoteUsd: 100,
    status: "submitted",
    reconcileState: "pending",
    reconciledAt: null,
    provider: "mock",
    detail: "Coinbase accepted the order.",
    orderId: "x-1",
    clientOrderId: "o-1",
    previewId: "p",
    exchangeStatus: null,
    filledSize: null,
    averagePrice: null,
    totalFees: null,
    signalId: null,
    riskDecision: decision,
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:01.000Z",
    ...overrides
  };
}

const preview = { previewId: "p", orderTotal: 100, commissionTotal: 0.6, bestBid: 1, bestAsk: 1, baseSize: 0.002, quoteSize: 100, errors: [], warnings: [] };
const previewed: PreviewState = { step: "previewed", order: order({ status: "previewed" }), decision, preview };

describe("ticketStep", () => {
  it("walks preview, confirm and result", () => {
    expect(ticketStep({ step: "idle" }, { step: "idle" })).toBe(1);
    expect(ticketStep({ step: "error", error: "x" }, { step: "idle" })).toBe(1);
    expect(ticketStep(previewed, { step: "idle" })).toBe(2);
    expect(ticketStep(previewed, { step: "result", order: order() })).toBe(3);
  });

  it("keeps the confirm step after a submit error so the user can fix it and retry", () => {
    const failed: SubmitState = { step: "error", error: "Tick the confirmation that you reviewed the risk checks and the exchange preview." };
    expect(ticketStep(previewed, failed)).toBe(2);
  });
});

describe("freshestOrder", () => {
  it("shows the reconciled row once the page has it, instead of the stale submit result", () => {
    const submitted = order();
    const reconciled = order({ status: "filled", detail: "Filled 0.002 BTC at an average $50,000.00, fees $0.60.", updatedAt: "2026-10-10T12:00:09.000Z" });
    expect(freshestOrder(submitted, [order({ id: "other" }), reconciled])).toBe(reconciled);
  });

  it("keeps the result when the list is older or does not have the order", () => {
    const settled = order({ status: "filled", updatedAt: "2026-10-10T12:00:05.000Z" });
    expect(freshestOrder(settled, [order({ updatedAt: "2026-10-10T12:00:01.000Z" })])).toBe(settled);
    expect(freshestOrder(settled, [])).toBe(settled);
  });
});
