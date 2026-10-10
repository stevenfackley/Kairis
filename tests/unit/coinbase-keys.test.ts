import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { describe, expect, it } from "vitest";
import { CoinbaseKeyFormatError, normalizeCoinbaseCredentials } from "@/lib/exchange/keys";

const ECDSA_NAME = "organizations/3f1c2b7a-0000-4000-8000-000000000001/apiKeys/9a8b7c6d-0000-4000-8000-000000000002";
const ED_ID = "6c1d2e3f-0000-4000-8000-000000000003";

function ecKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { sec1: privateKey.export({ type: "sec1", format: "pem" }).toString(), pkcs8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey };
}

function edKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const seed = Buffer.from(jwk.d!, "base64url");
  const pub = Buffer.from(jwk.x!, "base64url");
  return {
    // What the CDP portal download holds: base64(seed || public key).
    portal: Buffer.concat([seed, pub]).toString("base64"),
    seedOnly: seed.toString("base64"),
    pkcs8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey
  };
}

const request = { requestMethod: "GET", requestHost: "api.coinbase.com", requestPath: "/api/v3/brokerage/key_permissions" };

/** Signs a real JWT with the SDK and checks the signature against the public key. */
async function signAndVerify(keyId: string, secret: string, publicKey: KeyObject) {
  const token = await generateJwt({ apiKeyId: keyId, apiKeySecret: secret, ...request });
  const [h, p, s] = token.split(".") as [string, string, string];
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid: string };
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as { sub: string; uris: string[] };
  const data = Buffer.from(`${h}.${p}`);
  const sig = Buffer.from(s, "base64url");
  const ok =
    header.alg === "ES256"
      ? verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)
      : verify(null, data, publicKey, sig);
  return { header, payload, ok };
}

describe("normalizeCoinbaseCredentials", () => {
  it("documents the SDK gap: generateJwt rejects the SEC1 PEM Coinbase hands out for ECDSA keys", async () => {
    const { sec1 } = ecKey();
    await expect(generateJwt({ apiKeyId: ECDSA_NAME, apiKeySecret: sec1, ...request })).rejects.toThrow("Invalid key format");
  });

  it("turns a SEC1 ECDSA key into PKCS#8 that signs a verifiable ES256 JWT", async () => {
    const { sec1, publicKey } = ecKey();
    const creds = normalizeCoinbaseCredentials(ECDSA_NAME, sec1);
    expect(creds.kind).toBe("ecdsa");
    expect(creds.secret.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
    const { header, payload, ok } = await signAndVerify(creds.keyId, creds.secret, publicKey);
    expect(ok).toBe(true);
    expect(header).toMatchObject({ alg: "ES256", kid: ECDSA_NAME });
    expect(payload.sub).toBe(ECDSA_NAME);
    expect(payload.uris).toEqual(["GET api.coinbase.com/api/v3/brokerage/key_permissions"]);
  });

  it("accepts the PEM with literal \\n escapes as copied out of the downloaded JSON", async () => {
    const { sec1, publicKey } = ecKey();
    const escaped = sec1.replace(/\n/g, "\\n");
    const creds = normalizeCoinbaseCredentials(` ${ECDSA_NAME} `, `"${escaped}"`);
    expect((await signAndVerify(creds.keyId, creds.secret, publicKey)).ok).toBe(true);
  });

  it("accepts CRLF line endings and a PEM flattened onto one line with spaces", async () => {
    const { sec1, publicKey } = ecKey();
    for (const mangled of [sec1.replace(/\n/g, "\r\n"), sec1.replace(/\n/g, " ")]) {
      const creds = normalizeCoinbaseCredentials(ECDSA_NAME, mangled);
      expect((await signAndVerify(creds.keyId, creds.secret, publicKey)).ok).toBe(true);
    }
  });

  it("accepts the whole downloaded ECDSA key file pasted into the private key box", async () => {
    const { sec1, publicKey } = ecKey();
    const file = JSON.stringify({ name: ECDSA_NAME, privateKey: sec1 });
    const creds = normalizeCoinbaseCredentials(ECDSA_NAME, file);
    expect((await signAndVerify(creds.keyId, creds.secret, publicKey)).ok).toBe(true);
  });

  it("passes a portal Ed25519 key through and it signs a verifiable EdDSA JWT", async () => {
    const { portal, publicKey } = edKey();
    const creds = normalizeCoinbaseCredentials(ED_ID, `${portal}\n`);
    expect(creds).toEqual({ keyId: ED_ID, secret: portal, kind: "ed25519" });
    const { header, ok } = await signAndVerify(creds.keyId, creds.secret, publicKey);
    expect(ok).toBe(true);
    expect(header).toMatchObject({ alg: "EdDSA", kid: ED_ID });
  });

  it("expands a 32-byte Ed25519 seed and converts an Ed25519 PKCS#8 PEM, both of which the SDK rejects as-is", async () => {
    const { seedOnly, pkcs8, portal, publicKey } = edKey();
    await expect(generateJwt({ apiKeyId: ED_ID, apiKeySecret: seedOnly, ...request })).rejects.toThrow("Invalid key format");
    for (const input of [seedOnly, pkcs8]) {
      const creds = normalizeCoinbaseCredentials(ED_ID, input);
      expect(creds.secret).toBe(portal);
      expect((await signAndVerify(creds.keyId, creds.secret, publicKey)).ok).toBe(true);
    }
  });

  it("accepts an Ed25519 key with an organizations/… key name", () => {
    const { portal } = edKey();
    expect(normalizeCoinbaseCredentials(ECDSA_NAME, portal).kind).toBe("ed25519");
  });

  it("is idempotent, so a stored normalized secret normalizes to itself", () => {
    const ec = normalizeCoinbaseCredentials(ECDSA_NAME, ecKey().sec1);
    expect(normalizeCoinbaseCredentials(ec.keyId, ec.secret)).toEqual(ec);
    const ed = normalizeCoinbaseCredentials(ED_ID, edKey().portal);
    expect(normalizeCoinbaseCredentials(ed.keyId, ed.secret)).toEqual(ed);
  });

  it("refuses an ECDSA key whose id is not the full organizations/…/apiKeys/… name", () => {
    expect(() => normalizeCoinbaseCredentials("9a8b7c6d-0000-4000-8000-000000000002", ecKey().sec1)).toThrow(/organizations\/\{org_id\}\/apiKeys\/\{key_id\}/);
  });

  it("refuses non-P-256 EC keys, RSA keys, junk and damaged Ed25519 keys with plain messages and no key material", () => {
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey.export({ type: "sec1", format: "pem" }).toString();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { portal } = edKey();
    const damaged = Buffer.concat([Buffer.from(portal, "base64").subarray(0, 32), Buffer.alloc(32, 7)]).toString("base64");
    const cases: Array<[string, RegExp]> = [
      [p384, /P-256/],
      [rsa, /neither an Ed25519 nor an ECDSA/],
      ["not a key", /not in a format Coinbase issues/],
      [Buffer.alloc(48, 1).toString("base64"), /not in a format Coinbase issues/],
      [damaged, /damaged/],
      ["-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----", /BEGIN and END lines do not match/],
      ["-----BEGIN EC PRIVATE KEY-----\n!!!!\n-----END EC PRIVATE KEY-----", /not in a format Coinbase issues/]
    ];
    for (const [secret, message] of cases) {
      let caught: unknown;
      try {
        normalizeCoinbaseCredentials(ECDSA_NAME, secret);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoinbaseKeyFormatError);
      expect((caught as Error).message).toMatch(message);
      if (secret.length > 70) expect((caught as Error).message).not.toContain(secret.slice(40, 70));
    }
  });

  it("refuses a missing id, a missing secret, or the private key pasted into the id box", () => {
    const { sec1 } = ecKey();
    expect(() => normalizeCoinbaseCredentials("", sec1)).toThrow("required");
    expect(() => normalizeCoinbaseCredentials(ECDSA_NAME, "  ")).toThrow("required");
    expect(() => normalizeCoinbaseCredentials(sec1, sec1)).toThrow(/does not look like a Coinbase key id/);
  });
});
