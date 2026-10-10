import { describe, expect, it } from "vitest";
import { isUuid, MAX_NOTE_LENGTH, normalizeProductId, parseOrderForm } from "@/lib/domain/order-form";

const WATCHLIST = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
const SIGNAL = "3f2b8c4e-1d2a-4b5c-9e8f-0a1b2c3d4e5f";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const valid = { product: "BTC-USD", side: "BUY", quoteUsd: "100" };

function errorOf(entries: Record<string, string>): string {
  const result = parseOrderForm(form(entries), WATCHLIST);
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.intent)}`);
  return result.error;
}

describe("parseOrderForm", () => {
  it("accepts a watchlist ticket and trims every field", () => {
    expect(parseOrderForm(form({ product: " ETH-USD ", side: " SELL ", quoteUsd: " 25.5 ", note: "  take profit  ", signalId: ` ${SIGNAL} ` }), WATCHLIST)).toEqual({
      ok: true,
      intent: { productId: "ETH-USD", side: "SELL", quoteUsd: 25.5, note: "take profit", signalId: SIGNAL }
    });
  });

  it("defaults the note to empty and the signal to null", () => {
    expect(parseOrderForm(form(valid), WATCHLIST)).toEqual({
      ok: true,
      intent: { productId: "BTC-USD", side: "BUY", quoteUsd: 100, note: "", signalId: null }
    });
  });

  describe("product", () => {
    it("upper-cases a custom product", () => {
      const result = parseOrderForm(form({ ...valid, product: "custom", customProduct: " avax-usd " }), WATCHLIST);
      expect(result.ok && result.intent.productId).toBe("AVAX-USD");
    });

    it("ignores the custom text unless Custom is selected", () => {
      const result = parseOrderForm(form({ ...valid, customProduct: "AVAX-USD" }), WATCHLIST);
      expect(result.ok && result.intent.productId).toBe("BTC-USD");
    });

    it("asks for a custom product when Custom is selected with no text", () => {
      expect(errorOf({ ...valid, product: "custom" })).toBe("Type the product you want, such as AVAX-USD.");
      expect(errorOf({ ...valid, product: "custom", customProduct: "   " })).toBe("Type the product you want, such as AVAX-USD.");
    });

    it.each(["bitcoin", "BTC-EUR", "BTC", "B-USD", "ABCDEFGHIJK-USD", "BTC-USDC", "BTC_USD", "B TC-USD"])("rejects the custom id %s", (custom) => {
      expect(errorOf({ ...valid, product: "custom", customProduct: custom })).toBe(
        `"${custom}" is not a Coinbase USD pair. Use the form COIN-USD, such as AVAX-USD.`
      );
    });

    it("requires a product", () => {
      expect(errorOf({ side: "BUY", quoteUsd: "100" })).toBe("Choose a product.");
      expect(errorOf({ ...valid, product: "" })).toBe("Choose a product.");
    });

    it("rejects a select value that is not on the watchlist", () => {
      expect(errorOf({ ...valid, product: "DOGE-USD" })).toBe("That product is not on the watchlist. Choose Custom to type another one.");
      expect(errorOf({ ...valid, product: "btc-usd" })).toBe("That product is not on the watchlist. Choose Custom to type another one.");
    });
  });

  describe("side", () => {
    it("accepts either case", () => {
      const result = parseOrderForm(form({ ...valid, side: "sell" }), WATCHLIST);
      expect(result.ok && result.intent.side).toBe("SELL");
    });

    it("requires buy or sell", () => {
      expect(errorOf({ ...valid, side: "HOLD" })).toBe("Choose buy or sell.");
      expect(errorOf({ product: "BTC-USD", quoteUsd: "100" })).toBe("Choose buy or sell.");
    });
  });

  describe("quoteUsd", () => {
    it.each([
      ["0.01", 0.01],
      ["25.50", 25.5],
      ["25.500", 25.5],
      [".5", 0.5],
      ["1000000", 1_000_000]
    ])("accepts %s", (raw, expected) => {
      const result = parseOrderForm(form({ ...valid, quoteUsd: raw }), WATCHLIST);
      expect(result.ok && result.intent.quoteUsd).toBe(expected);
    });

    it("requires a size", () => {
      expect(errorOf({ product: "BTC-USD", side: "BUY" })).toBe("Enter an order size in US dollars.");
      expect(errorOf({ ...valid, quoteUsd: "  " })).toBe("Enter an order size in US dollars.");
    });

    it.each(["abc", "1e3", "0x10", "Infinity", "1,000", "$100", "12.3.4"])("rejects the non-number %s", (raw) => {
      expect(errorOf({ ...valid, quoteUsd: raw })).toBe("Order size must be a plain dollar amount, such as 100 or 25.50.");
    });

    it("rejects an overflowing number", () => {
      expect(errorOf({ ...valid, quoteUsd: "9".repeat(400) })).toBe("Order size must be a plain dollar amount, such as 100 or 25.50.");
    });

    it.each(["0", "0.00", "-1", "-0.01"])("rejects the non-positive size %s", (raw) => {
      expect(errorOf({ ...valid, quoteUsd: raw })).toBe("Order size must be more than $0.");
    });

    it.each(["0.001", "10.555"])("rejects sub-cent precision in %s", (raw) => {
      expect(errorOf({ ...valid, quoteUsd: raw })).toBe("Order size can have at most two decimal places (whole cents).");
    });

    it("caps a single ticket at $1,000,000", () => {
      expect(errorOf({ ...valid, quoteUsd: "1000000.01" })).toBe("Order size is capped at $1,000,000 per ticket.");
      expect(errorOf({ ...valid, quoteUsd: "2000000" })).toBe("Order size is capped at $1,000,000 per ticket.");
    });
  });

  describe("note", () => {
    it(`accepts ${MAX_NOTE_LENGTH} characters after trimming`, () => {
      const result = parseOrderForm(form({ ...valid, note: `  ${"a".repeat(MAX_NOTE_LENGTH)}  ` }), WATCHLIST);
      expect(result.ok && result.intent.note).toHaveLength(MAX_NOTE_LENGTH);
    });

    it("rejects a longer note", () => {
      expect(errorOf({ ...valid, note: "a".repeat(MAX_NOTE_LENGTH + 1) })).toBe(
        `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer (it has ${MAX_NOTE_LENGTH + 1}).`
      );
    });
  });

  describe("signalId", () => {
    it("is null when blank", () => {
      const result = parseOrderForm(form({ ...valid, signalId: "   " }), WATCHLIST);
      expect(result.ok && result.intent.signalId).toBeNull();
    });

    it("drops a malformed id instead of failing the order", () => {
      const result = parseOrderForm(form({ ...valid, signalId: "nope" }), WATCHLIST);
      expect(result.ok && result.intent.signalId).toBeNull();
    });
  });

  it("reads a file upload as a missing field", () => {
    const data = form({ side: "BUY", quoteUsd: "100" });
    data.set("product", new Blob(["BTC-USD"]));
    expect(parseOrderForm(data, WATCHLIST)).toEqual({ ok: false, error: "Choose a product." });
  });
});

describe("normalizeProductId", () => {
  it("upper-cases and trims a valid id", () => {
    expect(normalizeProductId(" sol-usd ")).toBe("SOL-USD");
  });

  it("returns null for anything else", () => {
    expect(normalizeProductId("SOL")).toBeNull();
    expect(normalizeProductId("")).toBeNull();
    expect(normalizeProductId(null)).toBeNull();
    expect(normalizeProductId(undefined)).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts a uuid in either case", () => {
    expect(isUuid(SIGNAL)).toBe(true);
    expect(isUuid(SIGNAL.toUpperCase())).toBe(true);
  });

  it("rejects other strings and missing values", () => {
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(`${SIGNAL}x`)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
