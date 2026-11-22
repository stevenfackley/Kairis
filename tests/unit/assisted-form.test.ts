import { describe, expect, it } from "vitest";
import { parseAssistedForm } from "@/app/app/trade/order-form";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const SIGNAL = "3f2b8c4e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";

function errorOf(fields: Record<string, string>): string {
  const result = parseAssistedForm(form(fields));
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.intent)}`);
  return result.error;
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

  it("keeps a well-formed signal id and drops anything else", () => {
    const valid = { productId: "BTC-USD", side: "BUY", quoteUsd: "10" };
    expect(parseAssistedForm(form({ ...valid, signalId: SIGNAL }))).toMatchObject({ ok: true, intent: { signalId: SIGNAL } });
    expect(parseAssistedForm(form({ ...valid, signalId: "nope" }))).toMatchObject({ ok: true, intent: { signalId: null } });
  });

  it("carries no note: the intent handed to previewAssisted has exactly the assisted fields", () => {
    const parsed = parseAssistedForm(form({ productId: "BTC-USD", side: "BUY", quoteUsd: "10", note: "ignored" }));
    expect(parsed.ok && Object.keys(parsed.intent).sort()).toEqual(["closePosition", "productId", "quoteUsd", "side", "signalId"]);
  });

  // Where this stand-in parser differs from lib/domain/order-form.ts (the paper ticket's parser).
  describe("rules that differ from the paper ticket's parser", () => {
    const valid = { productId: "BTC-USD", side: "BUY", quoteUsd: "100" };

    it("accepts any COIN-USD select value, on the watchlist or not", () => {
      expect(parseAssistedForm(form({ ...valid, productId: "DOGE-USD" }))).toMatchObject({ ok: true, intent: { productId: "DOGE-USD" } });
      expect(parseAssistedForm(form({ ...valid, productId: "btc-usd" }))).toMatchObject({ ok: true, intent: { productId: "BTC-USD" } });
    });

    it("rejects a lower-case side", () => {
      expect(errorOf({ ...valid, side: "sell" })).toBe("Choose Buy or Sell.");
    });

    it.each([".5", "1.500"])("rejects the size %s", (raw) => {
      expect(errorOf({ ...valid, quoteUsd: raw })).toBe("Order size must be a dollar amount with at most 2 decimals, such as 50 or 49.99.");
    });

    it("words its errors its own way", () => {
      expect(errorOf({ ...valid, productId: "custom" })).toBe("Enter a custom product such as SOL-USD.");
      expect(errorOf({ ...valid, productId: "custom", customProduct: "BTC-EUR" })).toBe('"BTC-EUR" is not a product such as SOL-USD.');
      expect(errorOf({ ...valid, quoteUsd: "1e3" })).toBe("Order size must be a dollar amount with at most 2 decimals, such as 50 or 49.99.");
      expect(errorOf({ ...valid, quoteUsd: "0" })).toBe("Order size must be greater than $0.");
      expect(errorOf({ ...valid, quoteUsd: "1000000.01" })).toBe("Order size must be at most $1,000,000.");
    });
  });
});
