import { describe, expect, it } from "vitest";
import { ExchangeHttpError, ExchangeTransportError, describeHttpFailure, normalizeExchangeError, scrubSecrets } from "@/lib/exchange/errors";
import { CoinbaseKeyFormatError } from "@/lib/exchange/keys";

describe("describeHttpFailure", () => {
  it("reads the Coinbase JSON error body into a sentence", () => {
    const e = describeHttpFailure(400, JSON.stringify({ error: "INVALID_ARGUMENT", code: 3, message: "invalid product_id", details: [] }));
    expect(e).toBeInstanceOf(ExchangeHttpError);
    expect(e.status).toBe(400);
    expect(e.reason).toBe("INVALID_ARGUMENT");
    expect(e.message).toBe("Coinbase rejected the request (HTTP 400): invalid product_id.");
  });

  it("prefers error_details, then message, then the errors[] shape of the Coinbase App API", () => {
    expect(describeHttpFailure(403, JSON.stringify({ error: "PERMISSION_DENIED", error_details: "Missing required scopes", message: "Missing required scopes" })).message).toBe(
      "Coinbase refused the request (HTTP 403): Missing required scopes."
    );
    expect(describeHttpFailure(429, JSON.stringify({ errors: [{ id: "rate_limit_exceeded", message: "Too many requests" }] })).message).toBe(
      "Coinbase is rate limiting requests (HTTP 429): Too many requests."
    );
  });

  it("keeps short plain-text bodies and drops HTML pages", () => {
    expect(describeHttpFailure(401, "Unauthorized\n").message).toBe("Coinbase rejected the API key (HTTP 401): Unauthorized.");
    expect(describeHttpFailure(502, "<html><body>Bad gateway</body></html>").message).toBe("Coinbase is not responding normally (HTTP 502).");
    expect(describeHttpFailure(404, "").message).toBe("Coinbase could not find what was asked for (HTTP 404).");
  });

  it("truncates long bodies", () => {
    expect(describeHttpFailure(400, "x".repeat(1000)).message.length).toBeLessThan(260);
  });
});

describe("scrubSecrets", () => {
  it("removes PEM blocks, JWTs and long base64 runs", () => {
    const pem = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIExampleExampleExample\n-----END EC PRIVATE KEY-----";
    const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl";
    const b64 = "A".repeat(86) + "==";
    const out = scrubSecrets(`key ${pem} token ${jwt} secret ${b64} order 7d2f4c1a-1b2c-4d5e-8f90-123456789abc`);
    expect(out).toBe("key [redacted key] token [redacted token] secret [redacted] order 7d2f4c1a-1b2c-4d5e-8f90-123456789abc");
  });
});

describe("normalizeExchangeError", () => {
  it("classifies typed HTTP errors by status", () => {
    expect(normalizeExchangeError(describeHttpFailure(401, "Unauthorized"))).toMatchObject({ code: "auth_error", retriable: false, ambiguous: false, status: 401 });
    expect(normalizeExchangeError(describeHttpFailure(403, ""))).toMatchObject({ code: "forbidden", retriable: false });
    expect(normalizeExchangeError(describeHttpFailure(404, ""))).toMatchObject({ code: "not_found", retriable: false });
    expect(normalizeExchangeError(describeHttpFailure(400, ""))).toMatchObject({ code: "rejected", retriable: false, ambiguous: false });
    expect(normalizeExchangeError(describeHttpFailure(429, ""))).toMatchObject({ code: "rate_limited", retriable: true, ambiguous: false });
    expect(normalizeExchangeError(describeHttpFailure(503, ""))).toMatchObject({ code: "provider_unavailable", retriable: true, ambiguous: true });
  });

  it("treats timeouts and network failures as retriable and ambiguous (the request may have landed)", () => {
    expect(normalizeExchangeError(new ExchangeTransportError("timeout", "Coinbase did not answer within 10 s."))).toMatchObject({
      code: "timeout",
      retriable: true,
      ambiguous: true,
      message: "Coinbase did not answer within 10 s."
    });
    expect(normalizeExchangeError(new ExchangeTransportError("network", "x"))).toMatchObject({ code: "network", retriable: true, ambiguous: true });
  });

  it("maps key format problems to a reconnect recommendation", () => {
    const n = normalizeExchangeError(new CoinbaseKeyFormatError("The private key is not in a format Coinbase issues."));
    expect(n).toMatchObject({ code: "key_format", retriable: false, message: "The private key is not in a format Coinbase issues." });
    expect(n.recommendation).toMatch(/Reconnect/);
  });

  it("falls back to a parenthesised status in untyped messages without false positives", () => {
    expect(normalizeExchangeError(new Error("Coinbase request failed (503): busy"))).toMatchObject({ code: "provider_unavailable", retriable: true });
    expect(normalizeExchangeError(new Error("Coinbase request failed (401): nope"))).toMatchObject({ code: "auth_error" });
    // A dollar amount or an id containing 500 is not an HTTP status.
    expect(normalizeExchangeError(new Error("Sell $500 exceeds the $400 held."))).toMatchObject({ code: "provider_error", retriable: false });
    expect(normalizeExchangeError(new Error("order 4290-401-503 not found"))).toMatchObject({ code: "provider_error" });
    expect(normalizeExchangeError("weird")).toMatchObject({ code: "provider_error", message: "Unknown exchange provider error." });
  });

  it("never echoes secrets in the message", () => {
    const n = normalizeExchangeError(new Error("Failed: -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"));
    expect(n.message).toBe("Failed: [redacted key]");
  });
});
