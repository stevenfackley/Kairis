import { describe, expect, it } from "vitest";
import { generateKeyBase64, openSecret, sealSecret } from "@/lib/domain/crypto";

describe("crypto", () => {
  it("round-trips and binds to the key", () => {
    const key = generateKeyBase64();
    const sealed = sealSecret("-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----", key);
    expect(openSecret(sealed, key)).toMatch(/BEGIN EC/);
    expect(() => openSecret(sealed, generateKeyBase64())).toThrow();
  });
  it("rejects a key that is not 32 bytes", () => { expect(() => sealSecret("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/); });
});
