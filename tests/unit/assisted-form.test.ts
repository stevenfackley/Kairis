import { describe, expect, it } from "vitest";
import { parseAssistedForm } from "@/app/app/trade/order-form";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseAssistedForm", () => {
  it("parses a dollar-sized ticket", () => {
    expect(parseAssistedForm(form({ productId: "BTC-USD", side: "BUY", quoteUsd: "49.99" }))).toEqual({
      ok: true,
      intent: { productId: "BTC-USD", side: "BUY", quoteUsd: 49.99, signalId: null, closePosition: false }
    });
  });

  it("rejects bad sizes and sides", () => {
    expect(parseAssistedForm(form({ productId: "BTC-USD", side: "BUY", quoteUsd: "1.234" }))).toMatchObject({ ok: false });
    expect(parseAssistedForm(form({ productId: "BTC-USD", side: "HOLD", quoteUsd: "10" }))).toEqual({ ok: false, error: "Choose Buy or Sell." });
    expect(parseAssistedForm(form({ productId: "BTC-USD", side: "SELL", quoteUsd: "" }))).toEqual({ ok: false, error: "Enter an order size in USD." });
  });

  it("turns 'Sell entire position' into a SELL with no dollar amount, whatever the side and size fields say", () => {
    expect(parseAssistedForm(form({ productId: "ETH-USD", side: "BUY", quoteUsd: "", closePosition: "yes" }))).toEqual({
      ok: true,
      intent: { productId: "ETH-USD", side: "SELL", quoteUsd: 0, signalId: null, closePosition: true }
    });
    expect(parseAssistedForm(form({ productId: "custom", customProduct: "avax-usd", closePosition: "yes" }))).toMatchObject({
      ok: true,
      intent: { productId: "AVAX-USD", side: "SELL", closePosition: true }
    });
  });

  it("still needs a product to close", () => {
    expect(parseAssistedForm(form({ productId: "", closePosition: "yes" }))).toEqual({ ok: false, error: "Choose a product." });
  });
});
