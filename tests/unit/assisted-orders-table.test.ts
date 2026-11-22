import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistedOrdersTable } from "@/components/assisted-orders-table";
import type { AssistedOrder, AssistedStatus } from "@/lib/types";

function order(id: string, status: AssistedStatus): AssistedOrder {
  const at = "2026-11-21T12:00:00.000Z";
  return {
    id,
    userId: "user-1",
    productId: "BTC-USD",
    side: "BUY",
    quoteUsd: 100,
    status,
    reconcileState: "reconciled",
    reconciledAt: at,
    provider: "mock",
    detail: "",
    orderId: null,
    clientOrderId: null,
    previewId: null,
    exchangeStatus: null,
    filledSize: null,
    averagePrice: null,
    totalFees: null,
    signalId: null,
    riskDecision: null,
    createdAt: at,
    updatedAt: at
  };
}

describe("AssistedOrdersTable", () => {
  it.each([
    ["filled", "pill-ok"],
    ["previewed", "pill-warn"],
    ["submitted", "pill-warn"],
    ["blocked", "pill-bad"],
    ["failed", "pill-bad"],
    ["cancelled", "pill-bad"],
    ["expired", "pill-bad"]
  ] as const)("shows a %s order with the %s pill", (status, tone) => {
    const html = renderToStaticMarkup(createElement(AssistedOrdersTable, { orders: [order("o-1", status)] }));
    expect(html).toContain(`<span class="pill ${tone}">${status}</span>`);
  });
});
