import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; tag: string };

function keyBytes(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("KAIRIS_SECRET_KEY must decode to 32 bytes.");
  return key;
}

export function generateKeyBase64(): string { return randomBytes(32).toString("base64"); }

export function sealSecret(plaintext: string, keyBase64: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function openSecret(sealed: Sealed, keyBase64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyBase64), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
