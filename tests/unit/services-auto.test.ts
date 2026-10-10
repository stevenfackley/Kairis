import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistedOrder, SignalRecord, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  refreshSignals: vi.fn(),
  previewAssisted: vi.fn(),
  submitAssisted: vi.fn(),
  getLimits: vi.fn(),
  buildRiskContext: vi.fn(),
  getMarketSnapshot: vi.fn(),
  appendAudit: vi.fn(),
  getConnectionStatus: vi.fn()
}));

vi.mock("@/lib/server/services/signals", () => ({ refreshSignals: m.refreshSignals }));
vi.mock("@/lib/server/services/assisted", () => ({ previewAssisted: m.previewAssisted, submitAssisted: m.submitAssisted }));
vi.mock("@/lib/server/services/risk", () => ({ buildRiskContext: m.buildRiskContext }));
vi.mock("@/lib/server/services/market", () => ({ getMarketSnapshot: m.getMarketSnapshot }));
vi.mock("@/lib/server/repos/limits", () => ({ getLimits: m.getLimits }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));
vi.mock("@/lib/server/services/exchange-connection", () => ({ getConnectionStatus: m.getConnectionStatus }));

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
  m.buildRiskContext.mockResolvedValue({ positions: {} });
  m.appendAudit.mockResolvedValue(undefined);
  m.getConnectionStatus.mockResolvedValue({ userId: USER, provider: "coinbase", canTrade: true });
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

  it("refuses without a connected Coinbase key instead of trading against the mock provider", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    m.getConnectionStatus.mockResolvedValue(null);
    await expect(runAutoCycle(USER, { isOwner: true })).rejects.toThrow("Auto mode needs a connected Coinbase key.");
    expect(m.refreshSignals).not.toHaveBeenCalled();
  });

  it("never runs two cycles at once for the same account", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    let release: (value: never[]) => void = () => undefined;
    m.refreshSignals.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = runAutoCycle(USER, { isOwner: true });
    await expect(runAutoCycle(USER, { isOwner: true })).rejects.toThrow("An auto cycle is already running for this account; wait for it to finish.");
    release([]);
    await expect(first).resolves.toMatchObject({ evaluated: 0 });

    m.refreshSignals.mockResolvedValue([]);
    await expect(runAutoCycle(USER, { isOwner: true })).resolves.toMatchObject({ evaluated: 0 });
  });

  it("keeps going when one product fails", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    m.refreshSignals.mockResolvedValue([signal("BTC-USD", "long", 2), signal("ETH-USD", "long", 2)]);
    m.previewAssisted.mockImplementation(async (_user: string, intent: { productId: string }) => {
      if (intent.productId === "BTC-USD") throw new Error("Coinbase preview failed");
      return { decision: { outcome: "approved", checks: [], reasons: [], evaluatedAt: "" }, order: { id: "order-eth" }, preview: null };
    });
    m.submitAssisted.mockResolvedValue({ status: "submitted", detail: "ok" });

    const summary = await runAutoCycle(USER, { isOwner: true });

    expect(summary).toMatchObject({ previewed: 1, submitted: 1, skipped: ["BTC-USD: Coinbase preview failed"] });
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
    expect(summary).toEqual({ evaluated: 3, previewed: 1, submitted: 1, exited: 0, skipped: ["SOL-USD: no ATR-based size available."] });
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "auto", "cycle", "Evaluated 3, previewed 1, submitted 1, exited 0. Skipped: SOL-USD: no ATR-based size available.");
  });

  it("sizes an entry no larger than the product's per-symbol cap", async () => {
    const { runAutoCycle } = await load({ auto: true, live: true });
    m.getLimits.mockResolvedValue({ ...limits, perSymbolMaxUsd: { "BTC-USD": 300 } });
    m.refreshSignals.mockResolvedValue([signal("BTC-USD", "long", 2)]);
    m.previewAssisted.mockResolvedValue({ decision: { outcome: "approved", checks: [], reasons: [], evaluatedAt: "" }, order: { id: "order-1" }, preview: null });
    m.submitAssisted.mockResolvedValue({ status: "submitted", detail: "ok" } satisfies Partial<AssistedOrder>);

    await runAutoCycle(USER, { isOwner: true });

    expect(m.previewAssisted).toHaveBeenCalledWith(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 300, signalId: "sig-BTC-USD" });
  });

  describe("exits", () => {
    const approved = { outcome: "approved", checks: [], reasons: [], evaluatedAt: "" };

    function snapshot(productId: string, closes: number[], price: number) {
      return {
        candles: closes.map((close, i) => ({ start: i, open: close, high: close, low: close, close, volume: 1 })),
        ticker: { productId, price, bestBid: price, bestAsk: price, tradeTime: Date.now() },
        fetchedAt: Date.now()
      };
    }

    const falling = Array.from({ length: 40 }, (_, i) => 200 - i);
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);

    it("sells the full position of a held product whose fast EMA is below the slow EMA", async () => {
      const { runAutoCycle } = await load({ auto: true, live: true });
      m.refreshSignals.mockResolvedValue([]);
      m.buildRiskContext.mockResolvedValue({
        positions: {
          "BTC-USD": { baseSize: 0.123456, avgCost: 150, notionalUsd: 0 },
          "ETH-USD": { baseSize: 2, avgCost: 100, notionalUsd: 0 },
          "SOL-USD": { baseSize: 0, avgCost: 0, notionalUsd: 0 }
        }
      });
      m.getMarketSnapshot.mockImplementation(async (productId: string) =>
        productId === "BTC-USD" ? snapshot(productId, falling, 161.11) : snapshot(productId, rising, 140)
      );
      m.previewAssisted.mockResolvedValue({ decision: approved, order: { id: "sell-1" }, preview: null });
      m.submitAssisted.mockResolvedValue({ status: "submitted", detail: "ok" });

      const summary = await runAutoCycle(USER, { isOwner: true });

      // 0.123456 * 161.11 = 19.89 (rounded to cents).
      expect(m.previewAssisted).toHaveBeenCalledTimes(1);
      expect(m.previewAssisted).toHaveBeenCalledWith(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 19.89 });
      expect(m.submitAssisted).toHaveBeenCalledWith(USER, "sell-1");
      expect(summary).toEqual({ evaluated: 0, previewed: 1, submitted: 1, exited: 1, skipped: [] });
    });

    it("ignores dust-sized positions", async () => {
      const { runAutoCycle } = await load({ auto: true, live: true });
      m.refreshSignals.mockResolvedValue([]);
      m.buildRiskContext.mockResolvedValue({ positions: { "BTC-USD": { baseSize: 1e-10, avgCost: 150, notionalUsd: 0 } } });

      const summary = await runAutoCycle(USER, { isOwner: true });

      expect(m.getMarketSnapshot).not.toHaveBeenCalled();
      expect(summary.skipped).toEqual([]);
    });

    it("judges the exit trend on completed candles only", async () => {
      const { runAutoCycle } = await load({ auto: true, live: true });
      m.refreshSignals.mockResolvedValue([]);
      m.buildRiskContext.mockResolvedValue({ positions: { "ETH-USD": { baseSize: 2, avgCost: 100, notionalUsd: 0 } } });
      const closed = snapshot("ETH-USD", rising, 140);
      // A crash inside the unfinished current hour would flip the trend if it were used.
      const forming = { start: Math.floor(Date.now() / 1000) - 60, open: 139, high: 139, low: 20, close: 20, volume: 1 };
      m.getMarketSnapshot.mockResolvedValue({ ...closed, candles: [...closed.candles, forming] });

      const summary = await runAutoCycle(USER, { isOwner: true });

      expect(m.previewAssisted).not.toHaveBeenCalled();
      expect(summary.exited).toBe(0);
    });

    it("records a skip when the exit is blocked or the data is thin", async () => {
      const { runAutoCycle } = await load({ auto: true, live: true });
      m.refreshSignals.mockResolvedValue([]);
      m.buildRiskContext.mockResolvedValue({
        positions: { "BTC-USD": { baseSize: 1, avgCost: 150, notionalUsd: 0 }, "ETH-USD": { baseSize: 1, avgCost: 100, notionalUsd: 0 } }
      });
      m.getMarketSnapshot.mockImplementation(async (productId: string) =>
        productId === "BTC-USD" ? snapshot(productId, falling, 160) : snapshot(productId, [1, 2, 3], 3)
      );
      m.previewAssisted.mockResolvedValue({ decision: { ...approved, outcome: "blocked", reasons: ["Trading is paused."] }, order: { id: "x" }, preview: null });

      const summary = await runAutoCycle(USER, { isOwner: true });

      expect(m.submitAssisted).not.toHaveBeenCalled();
      expect(summary.exited).toBe(0);
      expect(summary.skipped).toEqual(["BTC-USD: exit blocked: Trading is paused.", "ETH-USD: not enough candles to judge the trend for an exit."]);
    });
  });
});
