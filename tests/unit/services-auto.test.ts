import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistedOrder, SignalRecord, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  refreshSignals: vi.fn(),
  previewAssisted: vi.fn(),
  submitAssisted: vi.fn(),
  getLimits: vi.fn(),
  appendAudit: vi.fn()
}));

vi.mock("@/lib/server/services/signals", () => ({ refreshSignals: m.refreshSignals }));
vi.mock("@/lib/server/services/assisted", () => ({ previewAssisted: m.previewAssisted, submitAssisted: m.submitAssisted }));
vi.mock("@/lib/server/repos/limits", () => ({ getLimits: m.getLimits }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));

const USER = "owner-1";

const limits: TradingLimits = {
  userId: USER,
  maxPositionUsd: 1500,
  dailyLossCapUsd: 300,
  maxTradesPerDay: 6,
  cooldownMinutes: 20,
  lossStreakTrigger: 2,
  perSymbolMaxUsd: {},
  tradingPaused: false,
  updatedAt: "2026-10-09T00:00:00.000Z"
};

function signal(productId: string, action: SignalRecord["action"], atrPct: number | null): SignalRecord {
  return {
    id: `sig-${productId}`,
    productId,
    action,
    setup: "Trend continuation",
    rationale: [],
    strength: 0.5,
    referencePrice: 100,
    atrPct,
    rsi: 55,
    spreadPct: 0.01,
    dataAgeMs: 1000,
    evaluatedAt: "2026-10-09T12:00:00.000Z"
  };
}

async function load(flags: { auto: boolean; live: boolean }) {
  vi.stubEnv("ENABLE_AUTO_MODE", String(flags.auto));
  vi.stubEnv("ENABLE_LIVE_ASSISTED_TRADING", String(flags.live));
  vi.resetModules();
  return import("@/lib/server/services/auto");
}

beforeEach(() => {
  vi.resetAllMocks();
  m.getLimits.mockResolvedValue(limits);
  m.appendAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runAutoCycle", () => {
  it("refuses non-owners even with every flag on", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    await expect(runAutoCycle(USER, { isOwner: false })).rejects.toThrow("Auto mode is owner-only.");
    expect(m.refreshSignals).not.toHaveBeenCalled();
  });

  it("refuses when ENABLE_AUTO_MODE is off", async () => {
    const { runAutoCycle } = await load({ auto: false, live: true });
    await expect(runAutoCycle(USER, { isOwner: true })).rejects.toThrow("Auto mode is disabled (ENABLE_AUTO_MODE=false).");
    expect(m.refreshSignals).not.toHaveBeenCalled();
  });

  it("refuses when live assisted trading is off", async () => {
    const { runAutoCycle } = await load({ auto: true, live: false });
    await expect(runAutoCycle(USER, { isOwner: true })).rejects.toThrow("Auto mode needs live assisted trading enabled.");
    expect(m.refreshSignals).not.toHaveBeenCalled();
  });

  it("previews and submits sized long signals, skipping the rest with a reason", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    m.refreshSignals.mockResolvedValue([signal("BTC-USD", "long", 2), signal("ETH-USD", "observe", 1), signal("SOL-USD", "long", null)]);
    m.previewAssisted.mockResolvedValue({ decision: { outcome: "approved", checks: [], reasons: [], evaluatedAt: "" }, order: { id: "order-1" }, preview: null });
    m.submitAssisted.mockResolvedValue({ status: "submitted", detail: "ok" } satisfies Partial<AssistedOrder>);

    const summary = await runAutoCycle(USER, { isOwner: true });

    // 300 * 0.25 / 2% = 3750, capped at the 1500 max position.
    expect(m.previewAssisted).toHaveBeenCalledWith(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 1500, signalId: "sig-BTC-USD" });
    expect(m.submitAssisted).toHaveBeenCalledWith(USER, "order-1");
    expect(summary).toEqual({ evaluated: 3, previewed: 1, submitted: 1, skipped: ["SOL-USD: no ATR-based size available."] });
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "auto", "cycle", JSON.stringify(summary));
  });
});
