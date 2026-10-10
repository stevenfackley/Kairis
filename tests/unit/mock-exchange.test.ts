import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/exchange/mock";

function makeClient() {
  let n = 0;
  return createMockClient(
    async () => 100,
    () => `id-${++n}`
  );
}

describe("mock exchange", () => {
  it("reports read-only permissions and balance", async () => {
    const c = makeClient();
    expect(c.provider).toBe("mock");
    expect(await c.keyPermissions()).toEqual({
      canView: true,
      canTrade: false,
      canTransfer: false,
      portfolioUuid: null
    });
    expect(await c.balances()).toEqual([{ currency: "USD", available: 10000 }]);
  });

  it("previews at the reference price", async () => {
    const p = await makeClient().previewOrder({ productId: "BTC-USD", side: "BUY", quoteUsd: 50 });
    expect(p.previewId).toBe("id-1");
    expect(p.orderTotal).toBe(50);
    expect(p.commissionTotal).toBe(0.3);
    expect(p.bestBid).toBeCloseTo(99.95);
    expect(p.bestAsk).toBeCloseTo(100.05);
    expect(p.warnings).toEqual(["Mock provider active: no live order will be sent."]);
  });

  it("creates and then reports a filled order", async () => {
    const c = makeClient();
    const r = await c.createOrder({ productId: "BTC-USD", side: "BUY", quoteUsd: 50, clientOrderId: "c1" });
    expect(r).toEqual({
      success: true,
      orderId: "id-1",
      clientOrderId: "c1",
      detail: "Mock order accepted for BUY BTC-USD with quote size 50."
    });
    expect(await c.getOrder("id-1")).toEqual({
      orderId: "id-1",
      status: "FILLED",
      filledSize: 0.5,
      averagePrice: 100,
      totalFees: 0.3,
      raw: "FILLED"
    });
  });

  it("returns UNKNOWN for unissued ids", async () => {
    const s = await makeClient().getOrder("never-issued");
    expect(s).toMatchObject({ orderId: "never-issued", status: "UNKNOWN", filledSize: null });
  });
});
