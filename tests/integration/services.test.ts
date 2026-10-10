import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Runs before the imports below evaluate lib/env.ts. The suite gets its own Postgres schema (via the
// connection's search_path) because vitest runs test files in parallel and repos.test.ts truncates the
// same tables. Exports go to a scratch folder, never to R2, and live assisted trading stays off: the
// mock provider is what this suite drives.
const { schema, scratchDir } = vi.hoisted(() => {
  const isolated = { schema: "kairis_services_test", scratchDir: ".local-data/test-services" };
  const url = process.env.DATABASE_URL ?? "";
  if (url) {
    const options = encodeURIComponent(`-c search_path=${isolated.schema}`);
    process.env.DATABASE_URL = `${url}${url.includes("?") ? "&" : "?"}options=${options}`;
  }
  process.env.LOCAL_DATA_DIR = isolated.scratchDir;
  process.env.ENABLE_LIVE_ASSISTED_TRADING = "false";
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    delete process.env[key];
  }
  return isolated;
});

import { closePool, query } from "@/lib/server/db";
import { getAssistedOrder } from "@/lib/server/repos/assisted";
import { listAudit } from "@/lib/server/repos/audit";
import { listExports } from "@/lib/server/repos/exports";
import { saveLimits } from "@/lib/server/repos/limits";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { previewAssisted, reconcileAssisted, submitAssisted } from "@/lib/server/services/assisted";
import { createExport } from "@/lib/server/services/exports";
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

describe.skipIf(!enabled)("services", () => {
  beforeAll(async () => {
    await query(`create schema if not exists ${schema}`);
    execFileSync("node", ["scripts/db-migrate.mjs"], { cwd: repoRoot, env: process.env, stdio: "pipe" });
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });
  });

  beforeEach(async () => {
    await query(
      "truncate table users, onboarding_states, trading_limits, paper_trades, audit_events, export_artifacts, assisted_orders, exchange_connections, signals"
    );
  });

  afterAll(async () => {
    __setMarketFetchers(null);
    await rm(path.resolve(repoRoot, scratchDir), { recursive: true, force: true });
    await query(`drop schema if exists ${schema} cascade`);
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
    expect(first.trade).toMatchObject({ status: "filled", baseSize: 6, price: PRICE, quoteUsd: 600 });
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
    expect(context.positions["BTC-USD"]).toMatchObject({ baseSize: 6, avgCost: PRICE, notionalUsd: 600 });
    expect(context.today.tradesCount).toBe(1);
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
    expect(filled).toMatchObject({ status: "filled", reconcileState: "reconciled", exchangeStatus: "FILLED", filledSize: 0.5, averagePrice: PRICE, totalFees: 0.3 });
    expect(filled?.reconciledAt).not.toBeNull();
    expect(await reconcileAssisted(USER)).toEqual({ checked: 0, updated: 0 });

    const actions = (await listAudit(USER, { category: "assisted-order" })).map((e) => e.action).sort();
    expect(actions).toEqual(["previewed", "submitted"]);
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
    expect(path.basename(artifact.location)).toMatch(/^paper-journal-user-1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.csv$/);
    const lines = (await readFile(artifact.location, "utf8")).split("\n");
    expect(lines[0]).toBe("id,createdAt,productId,side,baseSize,price,quoteUsd,status,realizedPnlUsd,signalId,note");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(",ETH-USD,BUY,0.25,100,25,filled,0,,\"has, a comma\"");
    expect(await listExports(USER)).toEqual([artifact]);
    expect(await listAudit(USER, { category: "export" })).toHaveLength(1);
  });
});
