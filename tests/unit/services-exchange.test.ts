import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyBase64, openSecret, type Sealed } from "@/lib/domain/crypto";
import type { KeyPermissions } from "@/lib/exchange/types";
import type { OnboardingState } from "@/lib/types";

const m = vi.hoisted(() => ({
  createCoinbaseClient: vi.fn(),
  saveConnection: vi.fn(),
  getConnection: vi.fn(),
  deleteConnection: vi.fn(),
  getOnboarding: vi.fn(),
  saveOnboarding: vi.fn(),
  appendAudit: vi.fn(),
  getReferencePrice: vi.fn()
}));

vi.mock("@/lib/exchange/coinbase", () => ({ createCoinbaseClient: m.createCoinbaseClient }));
vi.mock("@/lib/server/repos/exchange", () => ({
  saveConnection: m.saveConnection,
  getConnection: m.getConnection,
  deleteConnection: m.deleteConnection
}));
vi.mock("@/lib/server/repos/onboarding", () => ({ getOnboarding: m.getOnboarding, saveOnboarding: m.saveOnboarding }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));
vi.mock("@/lib/server/services/market", () => ({ getReferencePrice: m.getReferencePrice }));

const USER = "user-1";
const KEY_ID = "organizations/org/apiKeys/key";
// A real SEC1 PEM, the shape Coinbase hands out for ECDSA keys; the SDK needs it as PKCS#8.
const ecPrivate = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
const PEM = ecPrivate.export({ type: "sec1", format: "pem" }).toString().trim();
const PKCS8 = ecPrivate.export({ type: "pkcs8", format: "pem" }).toString();
const ED_ID = "6c1d2e3f-0000-4000-8000-000000000003";

const onboarding: OnboardingState = {
  userId: USER,
  preferredMode: "assisted",
  riskAcknowledged: true,
  exchangeConnected: false,
  completedAt: "2026-10-09T09:00:00.000Z",
  updatedAt: "2026-10-09T09:00:00.000Z"
};

function permissions(overrides: Partial<KeyPermissions> = {}): KeyPermissions {
  return { canView: true, canTrade: true, canTransfer: false, portfolioUuid: "pf-1", ...overrides };
}

async function load(secretKey: string) {
  vi.stubEnv("KAIRIS_SECRET_KEY", secretKey);
  vi.resetModules();
  return import("@/lib/server/services/exchange-connection");
}

beforeEach(() => {
  vi.resetAllMocks();
  m.getOnboarding.mockResolvedValue(onboarding);
  m.saveOnboarding.mockImplementation(async (s: Omit<OnboardingState, "updatedAt">) => ({ ...s, updatedAt: "now" }));
  m.appendAudit.mockResolvedValue(undefined);
  m.saveConnection.mockImplementation(async (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([k]) => k !== "sealed")));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("connectCoinbase", () => {
  it("refuses when KAIRIS_SECRET_KEY is empty", async () => {
    const { connectCoinbase } = await load("");
    await expect(connectCoinbase(USER, KEY_ID, PEM)).rejects.toThrow("Exchange connections are disabled: KAIRIS_SECRET_KEY is not set.");
    expect(m.createCoinbaseClient).not.toHaveBeenCalled();
    expect(m.saveConnection).not.toHaveBeenCalled();
  });

  it("requires both the key id and the secret", async () => {
    const { connectCoinbase } = await load(generateKeyBase64());
    await expect(connectCoinbase(USER, "  ", PEM)).rejects.toThrow("required");
    expect(m.createCoinbaseClient).not.toHaveBeenCalled();
  });

  it("rejects a key that can transfer funds", async () => {
    const { connectCoinbase } = await load(generateKeyBase64());
    m.createCoinbaseClient.mockReturnValue({ keyPermissions: async () => permissions({ canTransfer: true }) });

    await expect(connectCoinbase(USER, KEY_ID, PEM)).rejects.toThrow("This key can transfer funds.");
    expect(m.saveConnection).not.toHaveBeenCalled();
    expect(m.saveOnboarding).not.toHaveBeenCalled();
  });

  it("wraps provider errors with the normalized recommendation", async () => {
    const { connectCoinbase } = await load(generateKeyBase64());
    m.createCoinbaseClient.mockReturnValue({
      keyPermissions: async () => {
        throw new Error("Coinbase request failed (401): unauthorized");
      }
    });

    await expect(connectCoinbase(USER, KEY_ID, PEM)).rejects.toThrow(
      "Kairis could not validate this key with Coinbase: Coinbase request failed (401): unauthorized Check provider credentials, key permissions, and live-trading gating variables."
    );
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "exchange", "connect-failed", expect.stringContaining(`Coinbase key ${KEY_ID} refused: Kairis could not validate`));
  });

  it("audits every refused connect with the reason and key id but no key material", async () => {
    const { connectCoinbase } = await load(generateKeyBase64());
    m.createCoinbaseClient.mockReturnValue({ keyPermissions: async () => permissions({ canTransfer: true }) });

    await expect(connectCoinbase(USER, KEY_ID, "not-a-key")).rejects.toThrow("not in a format Coinbase issues");
    await expect(connectCoinbase(USER, PEM, PEM)).rejects.toThrow("does not look like a Coinbase key id");
    await expect(connectCoinbase(USER, KEY_ID, PEM)).rejects.toThrow("This key can transfer funds.");

    const audits = m.appendAudit.mock.calls.filter((c) => c[2] === "connect-failed").map((c) => String(c[3]));
    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatch(/^Coinbase key organizations\/org\/apiKeys\/key refused: The private key is not in a format Coinbase issues/);
    expect(audits[1]).toMatch(/^Coinbase key \(not shown\) refused:/);
    expect(audits[2]).toContain("This key can transfer funds.");
    const body = PEM.split("\n")[1]!;
    for (const detail of audits) {
      expect(detail).not.toContain(body);
    }
  });

  it("refuses a malformed private key before any call to Coinbase", async () => {
    const { connectCoinbase } = await load(generateKeyBase64());
    await expect(connectCoinbase(USER, KEY_ID, "-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----")).rejects.toThrow(
      "The private key block could not be read."
    );
    await expect(connectCoinbase(USER, "short-id", PEM)).rejects.toThrow("organizations/{org_id}/apiKeys/{key_id}");
    expect(m.createCoinbaseClient).not.toHaveBeenCalled();
  });

  it("seals the secret, marks onboarding connected and audits a trade-only key", async () => {
    const secretKey = generateKeyBase64();
    const { connectCoinbase } = await load(secretKey);
    m.createCoinbaseClient.mockReturnValue({ keyPermissions: async () => permissions() });

    // Pasted the way the downloaded JSON stores it: quoted, with literal \n escapes.
    const connection = await connectCoinbase(USER, `  ${KEY_ID}  `, `"${PEM.replace(/\n/g, "\\n")}\\n"`);

    expect(m.createCoinbaseClient).toHaveBeenCalledWith({ keyId: KEY_ID, secret: PKCS8 });
    const saved = m.saveConnection.mock.calls[0]![0] as { sealed: Sealed; keyId: string; canTransfer: boolean; portfolioUuid: string | null };
    expect(saved).toMatchObject({ keyId: KEY_ID, canTransfer: false, portfolioUuid: "pf-1" });
    expect(openSecret(saved.sealed, secretKey)).toBe(PKCS8);
    expect(connection).not.toHaveProperty("sealed");
    expect(m.saveOnboarding).toHaveBeenCalledWith({
      userId: USER,
      preferredMode: "assisted",
      riskAcknowledged: true,
      exchangeConnected: true,
      completedAt: onboarding.completedAt
    });
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "exchange", "connected", `Coinbase ecdsa key ${KEY_ID} validated: view=true trade=true`);
  });

  it("accepts an Ed25519 key from the CDP portal as-is", async () => {
    const secretKey = generateKeyBase64();
    const { connectCoinbase } = await load(secretKey);
    m.createCoinbaseClient.mockReturnValue({ keyPermissions: async () => permissions() });
    const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
    const portal = Buffer.concat([Buffer.from(jwk.d!, "base64url"), Buffer.from(jwk.x!, "base64url")]).toString("base64");

    await connectCoinbase(USER, ED_ID, portal);

    expect(m.createCoinbaseClient).toHaveBeenCalledWith({ keyId: ED_ID, secret: portal });
    const saved = m.saveConnection.mock.calls[0]![0] as { sealed: Sealed };
    expect(openSecret(saved.sealed, secretKey)).toBe(portal);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "exchange", "connected", `Coinbase ed25519 key ${ED_ID} validated: view=true trade=true`);
  });
});

describe("getExchangeClient", () => {
  it("falls back to the mock provider without a stored connection", async () => {
    const { getExchangeClient } = await load(generateKeyBase64());
    m.getConnection.mockResolvedValue(null);
    expect((await getExchangeClient(USER)).provider).toBe("mock");
  });
});
