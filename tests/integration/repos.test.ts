import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, query } from "@/lib/server/db";
import { getAssistedOrder, insertAssistedOrder, listAssistedOrders, listPendingAssistedOrders, updateAssistedOrder } from "@/lib/server/repos/assisted";
import { appendAudit, listAudit } from "@/lib/server/repos/audit";
import { deleteConnection, getConnection, saveConnection } from "@/lib/server/repos/exchange";
import { insertExport, listExports } from "@/lib/server/repos/exports";
import { getLimits, saveLimits, setTradingPaused } from "@/lib/server/repos/limits";
import { getOnboarding, saveOnboarding } from "@/lib/server/repos/onboarding";
import { insertPaperTrade, listPaperTrades } from "@/lib/server/repos/paper";
import { getSignal, insertSignal, latestSignals } from "@/lib/server/repos/signals";
import { getUser, upsertUser } from "@/lib/server/repos/users";
import { DEFAULT_LIMITS } from "@/lib/domain/strategy";
import type { AssistedOrder, PaperTrade, RiskDecision, SignalEvaluation } from "@/lib/types";

const databaseUrl = process.env.DATABASE_URL ?? "";

// beforeEach truncates every table, so refuse to run against anything but a local database
// unless explicitly opted in (the repo's .env files point at a shared remote instance).
function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

const enabled = Boolean(databaseUrl) && (isLocalDatabase(databaseUrl) || process.env.KAIRIS_ALLOW_REMOTE_TEST_DB === "true");
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const USER = "user-1";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const decision: RiskDecision = {
  outcome: "approved",
  checks: [{ code: "max-position", passed: true, detail: "Within cap." }],
  reasons: [],
  evaluatedAt: "2026-10-09T10:00:00.000Z"
};

function signal(productId: string, evaluatedAt: string, setup: string): SignalEvaluation {
  return {
    productId,
    action: "long",
    setup,
    rationale: ["EMA 9 above EMA 21.", "RSI in band."],
    strength: 0.725,
    referencePrice: 61234.5,
    atrPct: 1.2345,
    rsi: 55.5,
    spreadPct: 0.01,
    dataAgeMs: 1500,
    evaluatedAt
  };
}

function assisted(overrides: Partial<AssistedOrder>): AssistedOrder {
  return {
    id: "",
    userId: USER,
    productId: "BTC-USD",
    side: "BUY",
    quoteUsd: 50,
    status: "submitted",
    reconcileState: "pending",
    reconciledAt: null,
    provider: "mock",
    detail: "Submitted.",
    orderId: "ord-1",
    clientOrderId: "client-1",
    previewId: "prev-1",
    exchangeStatus: "PENDING",
    filledSize: null,
    averagePrice: null,
    totalFees: null,
    signalId: null,
    riskDecision: decision,
    createdAt: "",
    updatedAt: "",
    ...overrides
  };
}

describe.skipIf(!enabled)("repos", () => {
  beforeAll(() => {
    execFileSync("node", ["scripts/db-migrate.mjs"], { cwd: repoRoot, env: process.env, stdio: "pipe" });
  });

  beforeEach(async () => {
    await query(
      "truncate table users, onboarding_states, trading_limits, paper_trades, audit_events, export_artifacts, assisted_orders, exchange_connections, signals"
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("upsertUser inserts, then updates is_owner and last_seen_at", async () => {
    const first = await upsertUser({ id: USER, email: "a@example.com", displayName: "A", isOwner: false });
    await sleep(15);
    const second = await upsertUser({ id: USER, email: "b@example.com", displayName: "B", isOwner: true });
    expect(second.isOwner).toBe(true);
    expect(second.email).toBe("b@example.com");
    expect(second.createdAt).toBe(first.createdAt);
    expect(Date.parse(second.lastSeenAt)).toBeGreaterThan(Date.parse(first.lastSeenAt));
    expect(await getUser(USER)).toEqual(second);
    expect(await getUser("nobody")).toBeNull();
  });

  it("getOnboarding defaults, saveOnboarding stamps completedAt on acknowledgment", async () => {
    const initial = await getOnboarding(USER);
    expect(initial).toMatchObject({ userId: USER, preferredMode: "paper", riskAcknowledged: false, exchangeConnected: false, completedAt: null });
    const saved = await saveOnboarding({ userId: USER, preferredMode: "assisted", riskAcknowledged: true, exchangeConnected: false, completedAt: null });
    expect(saved.preferredMode).toBe("assisted");
    expect(saved.completedAt).not.toBeNull();
    expect(await getOnboarding(USER)).toEqual(saved);
  });

  it("getLimits defaults, saveLimits round-trips perSymbolMaxUsd and tradingPaused", async () => {
    const defaults = await getLimits(USER);
    expect(defaults).toMatchObject({ userId: USER, ...DEFAULT_LIMITS, perSymbolMaxUsd: {}, tradingPaused: false });

    const saved = await saveLimits({
      userId: USER,
      maxPositionUsd: 1200.5,
      dailyLossCapUsd: 250,
      maxTradesPerDay: 4,
      cooldownMinutes: 30,
      lossStreakTrigger: 3,
      perSymbolMaxUsd: { "BTC-USD": 800, "ETH-USD": 400.25 },
      tradingPaused: true
    });
    expect(saved).toMatchObject({ maxPositionUsd: 1200.5, dailyLossCapUsd: 250, perSymbolMaxUsd: { "BTC-USD": 800, "ETH-USD": 400.25 }, tradingPaused: true });
    expect(await getLimits(USER)).toEqual(saved);

    const resumed = await setTradingPaused(USER, false);
    expect(resumed.tradingPaused).toBe(false);
    expect(resumed.perSymbolMaxUsd).toEqual({ "BTC-USD": 800, "ETH-USD": 400.25 });

    const fresh = await setTradingPaused("user-2", true);
    expect(fresh).toMatchObject({ userId: "user-2", ...DEFAULT_LIMITS, perSymbolMaxUsd: {}, tradingPaused: true });
  });

  it("saveLimits without a pause value keeps the stored pause, and a new row starts unpaused", async () => {
    const limits = { maxPositionUsd: 900, dailyLossCapUsd: 100, maxTradesPerDay: 3, cooldownMinutes: 15, lossStreakTrigger: 2, perSymbolMaxUsd: {} };
    await setTradingPaused(USER, true);
    const kept = await saveLimits({ userId: USER, ...limits });
    expect(kept).toMatchObject({ maxPositionUsd: 900, tradingPaused: true });
    expect((await saveLimits({ userId: USER, ...limits, tradingPaused: false })).tradingPaused).toBe(false);
    expect((await saveLimits({ userId: "user-3", ...limits })).tradingPaused).toBe(false);
  });

  it("latestSignals returns the newest signal per product, ordered by product", async () => {
    await insertSignal(signal("ETH-USD", "2026-10-09T09:00:00.000Z", "old-eth"));
    const newestEth = await insertSignal(signal("ETH-USD", "2026-10-09T10:00:00.000Z", "new-eth"));
    await insertSignal(signal("BTC-USD", "2026-10-09T11:00:00.000Z", "new-btc"));
    await insertSignal(signal("BTC-USD", "2026-10-09T08:00:00.000Z", "old-btc"));

    const latest = await latestSignals();
    expect(latest.map((s) => [s.productId, s.setup])).toEqual([
      ["BTC-USD", "new-btc"],
      ["ETH-USD", "new-eth"]
    ]);
    expect(newestEth).toMatchObject({ strength: 0.725, referencePrice: 61234.5, atrPct: 1.2345, rsi: 55.5, spreadPct: 0.01, dataAgeMs: 1500 });
    expect(newestEth.rationale).toEqual(["EMA 9 above EMA 21.", "RSI in band."]);
    expect(await getSignal(newestEth.id)).toEqual(newestEth);
  });

  it("insertSignal stores out-of-range and non-finite indicator values instead of failing the refresh", async () => {
    const wild = await insertSignal({
      ...signal("SOL-USD", "2026-10-09T12:00:00.000Z", "wild"),
      action: "blocked",
      strength: Number.NaN,
      referencePrice: Number.POSITIVE_INFINITY,
      atrPct: Number.POSITIVE_INFINITY,
      rsi: 250,
      spreadPct: 999_900
    });
    expect(wild).toMatchObject({ strength: 0, referencePrice: 0, atrPct: null, rsi: 100, spreadPct: 9999.9999 });
  });

  it("insertPaperTrade + listPaperTrades map side, numbers, fees and legacy planned rows", async () => {
    const base: PaperTrade = {
      id: "",
      userId: USER,
      productId: "BTC-USD",
      side: "BUY",
      baseSize: 0.0123,
      price: 60000.5,
      quoteUsd: 738.01,
      feeUsd: 4.42806369,
      status: "filled",
      realizedPnlUsd: 0,
      note: "entry",
      signalId: null,
      riskDecision: decision,
      createdAt: "2026-10-09T10:00:00.000Z"
    };
    const buy = await insertPaperTrade(base);
    expect(buy.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(buy.feeUsd).toBe(4.42806369);
    await insertPaperTrade({ ...base, side: "SELL", price: 61000, quoteUsd: 750.3, feeUsd: 4.5018, realizedPnlUsd: 12.29, note: "exit", createdAt: "2026-10-09T11:00:00.000Z" });
    await query(
      "insert into paper_trades (user_id, symbol, side, quantity, entry_price, status, created_at) values ($1, 'ETH-USD', 'buy', 1, 2000, 'planned', '2026-10-09T09:00:00Z')",
      [USER]
    );

    const trades = await listPaperTrades(USER);
    expect(trades.map((t) => [t.side, t.status, t.note])).toEqual([
      ["SELL", "filled", "exit"],
      ["BUY", "filled", "entry"],
      ["BUY", "blocked", ""]
    ]);
    expect(trades[0]).toMatchObject({ productId: "BTC-USD", baseSize: 0.0123, price: 61000, quoteUsd: 750.3, feeUsd: 4.5018, realizedPnlUsd: 12.29, riskDecision: decision });
    expect(trades[2]).toMatchObject({ productId: "ETH-USD", quoteUsd: 0, feeUsd: null, riskDecision: null });
    expect(await listPaperTrades(USER, 1)).toHaveLength(1);
  });

  it("insertAssistedOrder, partial updateAssistedOrder, listPendingAssistedOrders", async () => {
    const order = await insertAssistedOrder(assisted({}));
    await insertAssistedOrder(assisted({ status: "previewed", clientOrderId: null, orderId: null }));
    expect(order).toMatchObject({ quoteUsd: 50, status: "submitted", reconcileState: "pending", riskDecision: decision, filledSize: null });

    expect((await listPendingAssistedOrders(USER)).map((o) => o.id)).toEqual([order.id]);

    await sleep(15);
    const patched = await updateAssistedOrder(order.id, { exchangeStatus: "OPEN", filledSize: 0.00042 });
    expect(patched).toMatchObject({ exchangeStatus: "OPEN", filledSize: 0.00042, status: "submitted", detail: "Submitted.", orderId: "ord-1" });
    expect(Date.parse(patched.updatedAt)).toBeGreaterThan(Date.parse(order.updatedAt));

    const filled = await updateAssistedOrder(order.id, {
      status: "filled",
      reconcileState: "reconciled",
      reconciledAt: "2026-10-09T12:00:00.000Z",
      averagePrice: 61000.12345678,
      totalFees: 0.3
    });
    expect(filled).toMatchObject({ status: "filled", reconcileState: "reconciled", reconciledAt: "2026-10-09T12:00:00.000Z", averagePrice: 61000.12345678, totalFees: 0.3, filledSize: 0.00042 });
    expect(await listPendingAssistedOrders(USER)).toEqual([]);
    expect(await getAssistedOrder(order.id, USER)).toEqual(filled);
    expect(await getAssistedOrder(order.id, "someone-else")).toBeNull();
    expect(await listAssistedOrders(USER)).toHaveLength(2);
    await expect(insertAssistedOrder(assisted({}))).rejects.toThrow();
  });

  it("saveConnection/getConnection round-trip the sealed secret; deleteConnection removes it", async () => {
    const sealed = { ciphertext: "c1", iv: "iv1", tag: "t1" };
    const saved = await saveConnection({
      userId: USER,
      provider: "coinbase",
      keyId: "organizations/x/apiKeys/y",
      canView: true,
      canTrade: true,
      canTransfer: false,
      portfolioUuid: null,
      validatedAt: "2026-10-09T10:00:00.000Z",
      createdAt: "",
      sealed
    });
    expect(saved).not.toHaveProperty("sealed");
    expect(saved).toMatchObject({ keyId: "organizations/x/apiKeys/y", canTrade: true, canTransfer: false, validatedAt: "2026-10-09T10:00:00.000Z" });

    const stored = await getConnection(USER);
    expect(stored).toEqual({ ...saved, sealed });

    const rotated = await saveConnection({ ...saved, keyId: "k2", sealed: { ciphertext: "c2", iv: "iv2", tag: "t2" } });
    expect(rotated.createdAt).toBe(saved.createdAt);
    expect((await getConnection(USER))?.sealed).toEqual({ ciphertext: "c2", iv: "iv2", tag: "t2" });

    await deleteConnection(USER);
    expect(await getConnection(USER)).toBeNull();
  });

  it("appendAudit + listAudit filter by category", async () => {
    await appendAudit(USER, "limits", "save", "Limits saved.");
    await appendAudit(USER, "exchange", "connect", "Connected.");
    await appendAudit(USER, "limits", "pause", "Paused.");
    await appendAudit("user-2", "limits", "save", "Other user.");

    const all = await listAudit(USER);
    expect(all).toHaveLength(3);
    const limits = await listAudit(USER, { category: "limits" });
    expect(limits.map((e) => e.action).sort()).toEqual(["pause", "save"]);
    expect(limits.every((e) => e.userId === USER && e.category === "limits")).toBe(true);
    expect(await listAudit(USER, { limit: 1 })).toHaveLength(1);
  });

  it("insertExport + listExports", async () => {
    await insertExport({ id: "", userId: USER, type: "paper-journal", storage: "local", location: ".local-data/a.csv", createdAt: "2026-10-09T10:00:00.000Z" });
    const newer = await insertExport({ id: "", userId: USER, type: "audit-log", storage: "r2", location: "exports/b.csv", createdAt: "2026-10-09T11:00:00.000Z" });
    const list = await listExports(USER);
    expect(list.map((e) => e.type)).toEqual(["audit-log", "paper-journal"]);
    expect(list[0]).toEqual(newer);
    expect(await listExports("user-2")).toEqual([]);
  });
});
