import { createPrivateKey, type KeyObject } from "node:crypto";

/**
 * Coinbase CDP API keys come in two shapes (docs.cdp.coinbase.com, coinbase-advanced-py README):
 * - Ed25519 (the portal default): key id is a UUID, the secret is base64 of 64 bytes (seed || public key).
 * - ECDSA (legacy/"SDK compatible"): key name `organizations/{org}/apiKeys/{id}`, the secret is a SEC1
 *   PEM (`-----BEGIN EC PRIVATE KEY-----`).
 *
 * `generateJwt` in @coinbase/cdp-sdk 1.56 only accepts a PKCS#8 PEM for ES256 (jose importPKCS8) and a
 * 64-byte base64 string for EdDSA, so a SEC1 PEM straight from the Coinbase download is rejected as
 * "Invalid key format". Everything is normalized here into the two shapes the SDK accepts.
 */
export type CoinbaseKeyKind = "ecdsa" | "ed25519";
export type CoinbaseCredentials = { keyId: string; secret: string; kind: CoinbaseKeyKind };

/** A user-facing key problem. Its message never contains key material. */
export class CoinbaseKeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoinbaseKeyFormatError";
  }
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const PEM = /^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ECDSA_KEY_NAME = /^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/;

const NOT_A_KEY =
  "The private key is not in a format Coinbase issues. Paste the privateKey value from the downloaded key file: a base64 string for an Ed25519 key, or the whole -----BEGIN EC PRIVATE KEY----- block for an ECDSA key.";

function stripQuotes(value: string): string {
  const s = value.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/** Undoes what copying out of the downloaded JSON (or a .env line) does to the secret. */
function unwrapSecret(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("{")) {
    // The whole key file pasted into the box: take its privateKey.
    try {
      const parsed: unknown = JSON.parse(s);
      if (typeof parsed === "object" && parsed !== null && "privateKey" in parsed && typeof parsed.privateKey === "string") {
        s = parsed.privateKey;
      }
    } catch {
      // Not JSON after all; fall through and let the format checks explain.
    }
  }
  s = stripQuotes(s);
  // The JSON file stores newlines as the two characters \n; Windows pastes bring \r\n.
  return s.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n").trim();
}

/** Re-wraps a PEM whose line breaks were lost or mangled (spaces, one long line). */
function rewrapPem(label: string, body: string): string {
  const b64 = body.replace(/\s+/g, "");
  if (!b64 || !BASE64.test(b64)) {
    throw new CoinbaseKeyFormatError(NOT_A_KEY);
  }
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function ed25519Secret(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new CoinbaseKeyFormatError(NOT_A_KEY);
  }
  return Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
}

function fromKeyObject(key: KeyObject): { secret: string; kind: CoinbaseKeyKind } {
  if (key.asymmetricKeyType === "ed25519") {
    return { secret: ed25519Secret(key), kind: "ed25519" };
  }
  if (key.asymmetricKeyType === "ec") {
    if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new CoinbaseKeyFormatError("This EC private key is not on the P-256 curve that Coinbase ECDSA keys use.");
    }
    return { secret: key.export({ type: "pkcs8", format: "pem" }).toString(), kind: "ecdsa" };
  }
  throw new CoinbaseKeyFormatError("This private key is neither an Ed25519 nor an ECDSA (P-256) key, the two types Coinbase issues.");
}

function fromPem(text: string): { secret: string; kind: CoinbaseKeyKind } {
  const match = PEM.exec(text);
  if (!match) {
    throw new CoinbaseKeyFormatError(
      "The private key looks like a PEM block but its BEGIN and END lines do not match. Paste the whole block, from -----BEGIN to the matching -----END line."
    );
  }
  const label = match[1]!;
  if (label.includes("ENCRYPTED")) {
    throw new CoinbaseKeyFormatError("This private key is password-protected. Paste the unencrypted key from the Coinbase download.");
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(rewrapPem(label, match[2]!));
  } catch (error) {
    if (error instanceof CoinbaseKeyFormatError) throw error;
    throw new CoinbaseKeyFormatError("The private key block could not be read. Paste it again exactly as it appears in the downloaded key file.");
  }
  return fromKeyObject(key);
}

function fromBase64(text: string): { secret: string; kind: CoinbaseKeyKind } {
  const b64 = text.replace(/\s+/g, "");
  if (!BASE64.test(b64)) {
    throw new CoinbaseKeyFormatError(NOT_A_KEY);
  }
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32 && raw.length !== 64) {
    throw new CoinbaseKeyFormatError(NOT_A_KEY);
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
  } catch {
    throw new CoinbaseKeyFormatError(NOT_A_KEY);
  }
  const secret = ed25519Secret(key);
  // A 64-byte secret carries its own public half; a mismatch means it was truncated or mixed up.
  if (raw.length === 64 && !Buffer.from(secret, "base64").equals(raw)) {
    throw new CoinbaseKeyFormatError("This Ed25519 private key is damaged: its two halves do not belong together. Copy it again from the downloaded key file.");
  }
  return { secret, kind: "ed25519" };
}

/**
 * Validates and normalizes a pasted key id + private key into what generateJwt accepts.
 * Idempotent: normalizing an already-normalized pair returns it unchanged.
 */
export function normalizeCoinbaseCredentials(rawKeyId: string, rawSecret: string): CoinbaseCredentials {
  const keyId = stripQuotes(rawKeyId);
  const text = unwrapSecret(rawSecret);
  if (!keyId || !text) {
    throw new CoinbaseKeyFormatError("Both the API key id and the private key are required.");
  }
  if (/PRIVATE KEY/.test(keyId) || keyId.length > 200 || /\s/.test(keyId)) {
    throw new CoinbaseKeyFormatError(
      "The API key id does not look like a Coinbase key id. Paste the id (Ed25519 keys) or the organizations/…/apiKeys/… name (ECDSA keys) there, and the private key in the second box."
    );
  }
  const { secret, kind } = text.startsWith("-----BEGIN") ? fromPem(text) : fromBase64(text);
  if (kind === "ecdsa" && !ECDSA_KEY_NAME.test(keyId)) {
    throw new CoinbaseKeyFormatError(
      "For an ECDSA key, the API key id must be the full key name from the download, shaped like organizations/{org_id}/apiKeys/{key_id}."
    );
  }
  return { keyId, secret, kind };
}
