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
const PEM = `${["-----BEGIN", "EC PRIVATE KEY-----"].join(" ")}\nabc\n${["-----END", "EC PRIVATE KEY-----"].join(" ")}`;

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
      "Check provider credentials, key permissions, and live-trading gating variables. (auth_error)"
    );
  });

  it("seals the secret, marks onboarding connected and audits a trade-only key", async () => {
    const secretKey = generateKeyBase64();
    const { connectCoinbase } = await load(secretKey);
    m.createCoinbaseClient.mockReturnValue({ keyPermissions: async () => permissions() });

    const connection = await connectCoinbase(USER, `  ${KEY_ID}  `, `${PEM}\n`);

    expect(m.createCoinbaseClient).toHaveBeenCalledWith({ keyId: KEY_ID, secret: PEM });
    const saved = m.saveConnection.mock.calls[0]![0] as { sealed: Sealed; keyId: string; canTransfer: boolean; portfolioUuid: string | null };
    expect(saved).toMatchObject({ keyId: KEY_ID, canTransfer: false, portfolioUuid: "pf-1" });
    expect(openSecret(saved.sealed, secretKey)).toBe(PEM);
    expect(connection).not.toHaveProperty("sealed");
    expect(m.saveOnboarding).toHaveBeenCalledWith({
      userId: USER,
      preferredMode: "assisted",
      riskAcknowledged: true,
      exchangeConnected: true,
      completedAt: onboarding.completedAt
    });
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "exchange", "connected", `Coinbase key ${KEY_ID} validated: view=true trade=true`);
  });
});

describe("getExchangeClient", () => {
  it("falls back to the mock provider without a stored connection", async () => {
    const { getExchangeClient } = await load(generateKeyBase64());
    m.getConnection.mockResolvedValue(null);
    expect((await getExchangeClient(USER)).provider).toBe("mock");
  });
});
