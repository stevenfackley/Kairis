import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Runs before the imports below evaluate lib/env.ts. Exports go to a scratch folder, never to R2, and
// live assisted trading stays off: the mock provider is what this suite drives. Files run serially
// (vitest.config.ts), so this suite shares the database and truncation pattern with repos.test.ts.
const { scratchDir } = vi.hoisted(() => {
  const dir = ".local-data/test-services";
  process.env.LOCAL_DATA_DIR = dir;
  process.env.ENABLE_LIVE_ASSISTED_TRADING = "false";
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    delete process.env[key];
  }
  return { scratchDir: dir };
});

import { __setProductLoader, mapProduct } from "@/lib/exchange/coinbase-public";
import type { ProductRules } from "@/lib/exchange/types";
import { closePool, query } from "@/lib/server/db";
import { getAssistedOrder } from "@/lib/server/repos/assisted";
import { listAudit } from "@/lib/server/repos/audit";
import { listExports } from "@/lib/server/repos/exports";
import { saveLimits } from "@/lib/server/repos/limits";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { previewAssisted, reconcileAssisted, settleAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { createExport, openExportDownload } from "@/lib/server/services/exports";
import { __setMarketFetchers } from "@/lib/server/services/market";
import { placePaperOrder } from "@/lib/server/services/paper";
import { buildRiskContext } from "@/lib/server/services/risk";
import type { Candle, Ticker } from "@/lib/types";

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
const PRICE = 100;

function candles(): Candle[] {
  const nowSec = Math.floor(Date.now() / 1000);
  return Array.from({ length: 120 }, (_, i) => {
    const close = PRICE - 6 + i * 0.05;
    return { start: nowSec - (119 - i) * 3600 - 60, open: close - 0.02, high: close + 0.3, low: close - 0.3, close, volume: 25 };
  });
}

function ticker(productId: string): Ticker {
  return { productId, price: PRICE, bestBid: PRICE - 0.01, bestAsk: PRICE + 0.01, tradeTime: Date.now() };
}

// Coinbase's BTC-USD rules (captured 2026-10-10), applied to every product the suite trades.
function rules(productId: string): ProductRules {
  return {
    productId,
    baseCurrency: productId.split("-")[0]!,
    status: "online",
    baseIncrement: "0.00000001",
    quoteIncrement: "0.01",
    baseMinSize: "0.00000001",
    baseMaxSize: "3400",
    quoteMinSize: "1",
    quoteMaxSize: "150000000",
    isDisabled: false,
    tradingDisabled: false,
    cancelOnly: false,
    limitOnly: false,
    postOnly: false,
    viewOnly: false
  };
}

describe.skipIf(!enabled)("services", () => {
  beforeAll(async () => {
    execFileSync("node", ["scripts/db-migrate.mjs"], { cwd: repoRoot, env: process.env, stdio: "pipe" });
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });
    __setProductLoader(async (productId) => rules(productId));
  });

  beforeEach(async () => {
    await query(
      "truncate table users, onboarding_states, trading_limits, paper_trades, audit_events, export_artifacts, assisted_orders, exchange_connections, signals"
    );
  });

  afterAll(async () => {
    __setMarketFetchers(null);
    __setProductLoader(null);
    await rm(path.resolve(repoRoot, scratchDir), { recursive: true, force: true });
    await closePool();
  });

  it("fills a paper order, then blocks the next one at the max position", async () => {
    await saveLimits({
      userId: USER,
      maxPositionUsd: 1000,
      dailyLossCapUsd: 300,
      maxTradesPerDay: 6,
      cooldownMinutes: 20,
      lossStreakTrigger: 2,
      perSymbolMaxUsd: {},
      tradingPaused: false
    });

    const first = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 600 });
    expect(first.decision.outcome).toBe("approved");
    // $600 spent including the 0.6% fee, as on Coinbase: 600 / 1.006 = 596.42147117 of coins, 3.57852883 fee.
    expect(first.trade).toMatchObject({ status: "filled", baseSize: 5.96421471, price: PRICE, quoteUsd: 600, feeUsd: 3.57852883 });
    expect(first.trade.id).toMatch(/^[0-9a-f-]{36}$/);

    const second = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 600 });
    expect(second.decision.outcome).toBe("blocked");
    expect(second.decision.checks.find((c) => c.code === "max-position")).toMatchObject({ passed: false });
    expect(second.trade).toMatchObject({ status: "blocked", baseSize: 0, price: PRICE });
    expect(second.trade.riskDecision).toEqual(second.decision);

    const trades = await listPaperTrades(USER);
    expect(trades.map((t) => t.status).sort()).toEqual(["blocked", "filled"]);
    expect(await listAudit(USER, { category: "paper-trade" })).toHaveLength(2);
    expect(await listAudit(USER, { category: "risk" })).toHaveLength(2);

    const context = await buildRiskContext(USER, "paper", "BTC-USD");
    // The fee is part of the cost basis, which is the $600 spent: 600 / 5.96421471 = 100.60 a coin.
    expect(context.positions["BTC-USD"]?.baseSize).toBe(5.96421471);
    expect(context.positions["BTC-USD"]?.notionalUsd).toBeCloseTo(596.421471, 8);
    expect(context.positions["BTC-USD"]?.avgCost).toBeCloseTo(100.6, 6);
    expect(context.today.tradesCount).toBe(1);
  });

  it("sells an entire paper position exactly, net of both fees, and leaves it flat", async () => {
    await placePaperOrder(USER, { productId: "SOL-USD", side: "BUY", quoteUsd: 33.33 });
    const closed = await placePaperOrder(USER, { productId: "SOL-USD", side: "SELL", quoteUsd: 0, sellAll: true });

    expect(closed.decision.outcome).toBe("approved");
    // $33.33 bought 0.33131213 SOL (0.19878728 fee included); the sell pays 0.6% of 33.131213 = 0.19878728.
    expect(closed.trade).toMatchObject({ status: "filled", side: "SELL", baseSize: 0.33131213, quoteUsd: 33.13, feeUsd: 0.19878728 });
    // Flat at the same price: both fees are lost, 33.131213 - 0.19878728 - 33.33 = -0.39757456, stored to the cent.
    expect(closed.trade.realizedPnlUsd).toBe(-0.4);
    const context = await buildRiskContext(USER, "paper", "SOL-USD");
    expect(context.positions["SOL-USD"]).toBeUndefined();
    expect(context.today).toMatchObject({ tradesCount: 2, consecutiveLosses: 1 });
  });

  it("sizes paper orders with the product's Coinbase rules and closes a position without leaving dust", async () => {
    const shib = mapProduct(JSON.parse(await readFile(path.resolve(repoRoot, "tests/fixtures/coinbase/product-shib-usd.json"), "utf8")));
    const shibPrice = 0.00000546;
    __setProductLoader(async (productId) => (productId === "SHIB-USD" ? shib : rules(productId)));
    __setMarketFetchers({
      candles: async () => candles(),
      ticker: async (productId) => (productId === "SHIB-USD" ? { ...ticker(productId), price: shibPrice, bestBid: shibPrice, bestAsk: shibPrice } : ticker(productId))
    });
    try {
      const small = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 0.5 });
      expect(small.decision).toMatchObject({ outcome: "blocked", reasons: ["The smallest BTC-USD buy Coinbase accepts is $1.00."] });
      expect(small.trade).toMatchObject({ status: "blocked", baseSize: 0, feeUsd: null });

      // 100 / 1.006 / 0.00000546 = 18,205,783.21 SHIB: a fractional fill, as on Coinbase for a quote-sized buy.
      const bought = await placePaperOrder(USER, { productId: "SHIB-USD", side: "BUY", quoteUsd: 100 });
      expect(bought.trade).toMatchObject({ status: "filled", quoteUsd: 100, feeUsd: 0.59642147 });
      expect(bought.trade.baseSize % 1).not.toBe(0);

      // base_increment 1: $50 is 9,157,509.16 SHIB, sold as 9,157,509.
      const part = await placePaperOrder(USER, { productId: "SHIB-USD", side: "SELL", quoteUsd: 50 });
      expect(part.trade).toMatchObject({ status: "filled", baseSize: 9157509 });

      // The rest floors to whole SHIB with a fraction left over; the dust rule sells it all.
      const rest = await placePaperOrder(USER, { productId: "SHIB-USD", side: "SELL", quoteUsd: 0, sellAll: true });
      expect(rest.decision.outcome).toBe("approved");
      expect(rest.trade.baseSize).toBeCloseTo(bought.trade.baseSize - 9157509, 8);
      const context = await buildRiskContext(USER, "paper", "SHIB-USD");
      expect(context.positions["SHIB-USD"]).toBeUndefined();
    } finally {
      __setProductLoader(async (productId) => rules(productId));
      __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });
    }
  });

  it("previews and submits through the mock provider, then reconcile marks the order filled", async () => {
    const { decision, order, preview } = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 50 });
    expect(decision.outcome).toBe("approved");
    expect(order).toMatchObject({ status: "previewed", reconcileState: "pending", provider: "mock", quoteUsd: 50 });
    expect(preview?.previewId).toBeTruthy();
    expect(order.previewId).toBe(preview?.previewId);

    const submitted = await submitAssisted(USER, order.id);
    expect(submitted).toMatchObject({ status: "submitted", reconcileState: "pending", clientOrderId: order.id });
    expect(submitted.orderId).toBeTruthy();
    await expect(submitAssisted(USER, order.id)).rejects.toThrow("Only a previewed order can be submitted.");

    // An in-flight order already counts toward exposure before reconcile runs.
    const inFlight = await buildRiskContext(USER, "live", "BTC-USD");
    expect(inFlight.positions["BTC-USD"]?.baseSize).toBeCloseTo(0.5, 8);
    expect(inFlight.today.tradesCount).toBe(1);

    expect(await reconcileAssisted(USER)).toEqual({ checked: 1, updated: 1 });
    const filled = await getAssistedOrder(order.id, USER);
    // $50 spent including the fee, as on Coinbase: 49.70178926 bought coins and 0.29821074 was the fee.
    expect(filled).toMatchObject({ status: "filled", reconcileState: "reconciled", exchangeStatus: "FILLED", filledSize: 0.49701789, averagePrice: PRICE, totalFees: 0.29821074 });
    expect(filled?.orderSize).toEqual({ kind: "quote", quoteSize: "50" });
    expect(filled?.reconciledAt).not.toBeNull();
    expect(await reconcileAssisted(USER)).toEqual({ checked: 0, updated: 0 });

    const actions = (await listAudit(USER, { category: "assisted-order" })).map((e) => e.action).sort();
    expect(actions).toEqual(["previewed", "submitted"]);
  });

  it("settles a just-submitted order that already filled", async () => {
    const { order } = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 50 });
    const settled = await settleAssisted(USER, await submitAssisted(USER, order.id));
    expect(settled).toMatchObject({ status: "filled", reconcileState: "reconciled", exchangeStatus: "FILLED", filledSize: 0.49701789 });
    expect(settled.detail).toBe("Filled 0.49701789 BTC at an average $100.00, fees $0.30.");
    expect(await getAssistedOrder(order.id, USER)).toEqual(settled);
    expect(await reconcileAssisted(USER)).toEqual({ checked: 0, updated: 0 });
  });

  it("lets exactly one of two concurrent submits through", async () => {
    const { order } = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 50 });
    const results = await Promise.allSettled([submitAssisted(USER, order.id), submitAssisted(USER, order.id)]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof submitAssisted>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/already being submitted/);
    expect(fulfilled[0].value.status).toBe("submitted");

    const rows = await query<{ order_id: string | null }>("select order_id from assisted_orders where order_id is not null");
    expect(rows).toHaveLength(1);
    expect((await getAssistedOrder(order.id, USER))?.riskDecision?.outcome).toBe("approved");
  });

  it("writes a paper-journal export to a local CSV file with the header row", async () => {
    await placePaperOrder(USER, { productId: "ETH-USD", side: "BUY", quoteUsd: 25, note: "has, a comma" });

    const artifact = await createExport(USER, "paper-journal");

    expect(artifact).toMatchObject({ userId: USER, type: "paper-journal", storage: "local" });
    expect(path.isAbsolute(artifact.location)).toBe(true);
    expect(artifact.location.startsWith(path.resolve(repoRoot, scratchDir, "exports"))).toBe(true);
    expect(path.basename(artifact.location)).toMatch(/^paper-journal-user-1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f]{8}\.csv$/);
    const lines = (await readFile(artifact.location, "utf8")).split("\n");
    expect(lines[0]).toBe("id,createdAt,productId,side,baseSize,price,quoteUsd,feeUsd,status,realizedPnlUsd,signalId,note");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(",ETH-USD,BUY,0.24850895,100,25,0.14910537,filled,0,,\"has, a comma\"");
    expect(await listExports(USER)).toEqual([artifact]);
    expect(await listAudit(USER, { category: "export" })).toHaveLength(1);

    const download = await openExportDownload(USER, artifact.id);
    if (!download.ok) throw new Error(download.message);
    expect(download.fileName).toBe(path.basename(artifact.location));
    expect(await new Response(download.body).text()).toBe(await readFile(artifact.location, "utf8"));
    expect(await openExportDownload("someone-else", artifact.id)).toMatchObject({ ok: false, status: 404 });
    expect((await listAudit(USER, { category: "export" })).map((e) => e.action).sort()).toEqual(["created", "downloaded"]);
  });
});
