import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistedOrder, RiskDecision } from "@/lib/types";

const m = vi.hoisted(() => ({
  requireOnboarded: vi.fn(),
  previewAssisted: vi.fn(),
  submitAssisted: vi.fn(),
  settleAssisted: vi.fn(),
  reconcileAssisted: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/server/session", () => ({ requireOnboarded: m.requireOnboarded }));
vi.mock("@/lib/server/services/assisted", () => ({
  previewAssisted: m.previewAssisted,
  submitAssisted: m.submitAssisted,
  settleAssisted: m.settleAssisted,
  reconcileAssisted: m.reconcileAssisted
}));

import { previewAssistedAction } from "@/app/app/trade/actions";
import { INITIAL_PREVIEW } from "@/app/app/trade/state";

const USER = { id: "user-1", email: null, name: null, roles: [], isOwner: false };

const decision: RiskDecision = { outcome: "approved", checks: [], reasons: [], evaluatedAt: "2026-11-21T00:00:00.000Z" };
const preview = { orderTotal: 100, commissionTotal: 0.6, bestBid: 100, bestAsk: 100, warnings: [] };

function order(o: Partial<AssistedOrder>): AssistedOrder {
  return { id: "o-1", status: "previewed", provider: "mock", ...o } as AssistedOrder;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.requireOnboarded.mockResolvedValue(USER);
});

describe("previewAssistedAction", () => {
  it("stops at a form error before any preview", async () => {
    const state = await previewAssistedAction(INITIAL_PREVIEW, form({ productId: "", side: "BUY", quoteUsd: "10" }));
    expect(state).toEqual({ step: "error", error: "Choose a product." });
    expect(m.previewAssisted).not.toHaveBeenCalled();
  });

  // The action never picks the provider: previewAssisted does. Both providers go through the same path.
  it.each(["mock", "coinbase"] as const)("hands the parsed intent to previewAssisted unchanged (%s provider)", async (provider) => {
    const previewed = order({ provider });
    m.previewAssisted.mockResolvedValue({ decision, order: previewed, preview });

    const state = await previewAssistedAction(INITIAL_PREVIEW, form({ productId: "BTC-USD", side: "BUY", quoteUsd: "25" }));

    expect(m.previewAssisted).toHaveBeenCalledWith("user-1", { productId: "BTC-USD", side: "BUY", quoteUsd: 25, signalId: null, closePosition: false });
    expect(state).toEqual({ step: "previewed", order: previewed, decision, preview });
  });

  it("asks previewAssisted to close the whole position for 'Sell entire position'", async () => {
    const blocked = order({ status: "blocked" });
    m.previewAssisted.mockResolvedValue({ decision, order: blocked, preview: null });

    const state = await previewAssistedAction(INITIAL_PREVIEW, form({ productId: "ETH-USD", side: "BUY", quoteUsd: "", closePosition: "yes" }));

    expect(m.previewAssisted).toHaveBeenCalledWith("user-1", { productId: "ETH-USD", side: "SELL", quoteUsd: 0, signalId: null, closePosition: true });
    expect(state).toEqual({ step: "blocked", order: blocked, decision });
  });
});
