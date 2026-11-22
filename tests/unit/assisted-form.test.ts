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
    expect(parseAssistedForm(form({ product: "BTC-USD", side: "BUY", quoteUsd: "49.99" }))).toEqual({
      ok: true,
      intent: { productId: "BTC-USD", side: "BUY", quoteUsd: 49.99, signalId: null, closePosition: false }
    });
  });

  it("rejects bad sizes and sides", () => {
    expect(parseAssistedForm(form({ product: "BTC-USD", side: "BUY", quoteUsd: "1.234" }))).toMatchObject({ ok: false });
    expect(parseAssistedForm(form({ product: "BTC-USD", side: "HOLD", quoteUsd: "10" }))).toEqual({ ok: false, error: "Choose buy or sell." });
    expect(parseAssistedForm(form({ product: "BTC-USD", side: "SELL", quoteUsd: "" }))).toEqual({ ok: false, error: "Enter an order size in US dollars." });
  });

  it("turns 'Sell entire position' into a SELL with no dollar amount, whatever the side and size fields say", () => {
    expect(parseAssistedForm(form({ product: "ETH-USD", side: "BUY", quoteUsd: "", intent: "sell-all" }))).toEqual({
      ok: true,
      intent: { productId: "ETH-USD", side: "SELL", quoteUsd: 0, signalId: null, closePosition: true }
    });
    expect(parseAssistedForm(form({ product: "custom", customProduct: "avax-usd", intent: "sell-all" }))).toMatchObject({
      ok: true,
      intent: { productId: "AVAX-USD", side: "SELL", closePosition: true }
    });
  });

  it("still needs a product to close", () => {
    expect(parseAssistedForm(form({ product: "", intent: "sell-all" }))).toEqual({ ok: false, error: "Choose a product." });
  });

  it("keeps a well-formed signal id and drops anything else", () => {
    const valid = { product: "BTC-USD", side: "BUY", quoteUsd: "10" };
    expect(parseAssistedForm(form({ ...valid, signalId: SIGNAL }))).toMatchObject({ ok: true, intent: { signalId: SIGNAL } });
    expect(parseAssistedForm(form({ ...valid, signalId: "nope" }))).toMatchObject({ ok: true, intent: { signalId: null } });
  });

  it("carries no note: the intent handed to previewAssisted has exactly the assisted fields", () => {
    const parsed = parseAssistedForm(form({ product: "BTC-USD", side: "BUY", quoteUsd: "10", note: "ignored" }));
    expect(parsed.ok && Object.keys(parsed.intent).sort()).toEqual(["closePosition", "productId", "quoteUsd", "side", "signalId"]);
  });

  // Same rules as the paper ticket (lib/domain/order-form.ts), where the stand-in parser used to differ.
  describe("rules shared with the paper ticket", () => {
    const valid = { product: "BTC-USD", side: "BUY", quoteUsd: "100" };

    it("rejects a select value that is not on the watchlist", () => {
      expect(errorOf({ ...valid, product: "DOGE-USD" })).toBe("That product is not on the watchlist. Choose Custom to type another one.");
      expect(errorOf({ ...valid, product: "btc-usd" })).toBe("That product is not on the watchlist. Choose Custom to type another one.");
    });

    it("accepts a lower-case side", () => {
      expect(parseAssistedForm(form({ ...valid, side: "sell" }))).toMatchObject({ ok: true, intent: { side: "SELL" } });
    });

    it.each([
      [".5", 0.5],
      ["1.500", 1.5]
    ])("accepts the size %s", (raw, expected) => {
      expect(parseAssistedForm(form({ ...valid, quoteUsd: raw }))).toMatchObject({ ok: true, intent: { quoteUsd: expected } });
    });

    it("words its errors the paper ticket's way", () => {
      expect(errorOf({ ...valid, product: "custom" })).toBe("Type the product you want, such as AVAX-USD.");
      expect(errorOf({ ...valid, product: "custom", customProduct: "BTC-EUR" })).toBe('"BTC-EUR" is not a Coinbase USD pair. Use the form COIN-USD, such as AVAX-USD.');
      expect(errorOf({ ...valid, quoteUsd: "1e3" })).toBe("Order size must be a plain dollar amount, such as 100 or 25.50.");
      expect(errorOf({ ...valid, quoteUsd: "0" })).toBe("Order size must be more than $0.");
      expect(errorOf({ ...valid, quoteUsd: "1000000.01" })).toBe("Order size is capped at $1,000,000 per ticket.");
    });
  });
});
