import { env } from "@/lib/env";
import { normalizeExchangeError } from "@/lib/exchange/errors";
import { createMockClient } from "@/lib/exchange/mock";
import type { ExchangeClient, OrderPreview, OrderStatus, OrderSubmitResult } from "@/lib/exchange/types";
import {
  claimPreviewedOrder,
  getAssistedOrder,
  insertAssistedOrder,
  listPendingAssistedOrders,
  updateAssistedOrder,
  type AssistedOrderPatch
} from "@/lib/server/repos/assisted";
import { appendAudit } from "@/lib/server/repos/audit";
import { getConnectionStatus, getExchangeClient } from "@/lib/server/services/exchange-connection";
import { getReferencePrice } from "@/lib/server/services/market";
import { checkOrder } from "@/lib/server/services/risk";
import { errorMessage, storableUsd } from "@/lib/server/services/shared";
import type { AssistedOrder, OrderIntent, RiskDecision } from "@/lib/types";

export const PREVIEW_TTL_MS = 120_000;
const EXPIRED_DETAIL = "Preview expired after 2 minutes; preview again.";
const LIVE_DISABLED_DETAIL = "Live assisted trading is disabled by environment policy (ENABLE_LIVE_ASSISTED_TRADING=false).";
const PROVIDER_CHANGED_DETAIL = "The exchange connection changed since this preview; preview again.";
const NO_TRADE_PERMISSION_DETAIL =
  "The connected Coinbase key has no trade permission. Create a trade-only key (no transfer permission) and reconnect.";
const UNKNOWN_STATUS_DETAIL = "Exchange returned an unknown status; check the order on Coinbase.";

const label = (o: Pick<AssistedOrder, "side" | "productId" | "quoteUsd">) => `${o.side} ${o.productId} $${o.quoteUsd}`;

async function record(userId: string, order: AssistedOrder, action: string): Promise<AssistedOrder> {
  await appendAudit(userId, "assisted-order", action, `${label(order)}: ${order.detail}`);
  return order;
}

export async function previewAssisted(
  userId: string,
  intent: Omit<OrderIntent, "mode">
): Promise<{ decision: RiskDecision; order: AssistedOrder; preview: OrderPreview | null }> {
  const live: OrderIntent = { ...intent, mode: "live" };
  const { decision } = await checkOrder(userId, live);
  const client = await getExchangeClient(userId);
  const base: AssistedOrder = {
    id: "",
    userId,
    productId: live.productId,
    side: live.side,
    quoteUsd: storableUsd(live.quoteUsd),
    status: "blocked",
    reconcileState: "error",
    reconciledAt: null,
    provider: client.provider,
    detail: "",
    orderId: null,
    clientOrderId: null,
    previewId: null,
    exchangeStatus: null,
    filledSize: null,
    averagePrice: null,
    totalFees: null,
    signalId: live.signalId || null,
    riskDecision: decision,
    createdAt: "",
    updatedAt: ""
  };

  if (decision.outcome !== "approved") {
    const order = await insertAssistedOrder({
      ...base,
      status: "blocked",
      reconcileState: "error",
      reconciledAt: new Date().toISOString(),
      detail: decision.reasons.join(" ")
    });
    return { decision, order: await record(userId, order, "blocked"), preview: null };
  }

  if (client.provider === "coinbase" && (await getConnectionStatus(userId))?.canTrade === false) {
    const blocked: RiskDecision = {
      outcome: "blocked",
      checks: [...decision.checks, { code: "exchange-key", passed: false, detail: NO_TRADE_PERMISSION_DETAIL }],
      reasons: [...decision.reasons, NO_TRADE_PERMISSION_DETAIL],
      evaluatedAt: decision.evaluatedAt
    };
    const order = await insertAssistedOrder({
      ...base,
      status: "blocked",
      reconcileState: "error",
      reconciledAt: new Date().toISOString(),
      detail: NO_TRADE_PERMISSION_DETAIL,
      riskDecision: blocked
    });
    return { decision: blocked, order: await record(userId, order, "blocked"), preview: null };
  }

  let preview: OrderPreview;
  try {
    preview = await client.previewOrder({ productId: live.productId, side: live.side, quoteUsd: live.quoteUsd });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    await appendAudit(userId, "assisted-order", "preview-failed", `${label(live)}: ${normalized.message}`);
    throw new Error(normalized.message);
  }
  const order = await insertAssistedOrder({
    ...base,
    status: "previewed",
    reconcileState: "pending",
    reconciledAt: null,
    previewId: preview.previewId,
    detail: `Preview total $${preview.orderTotal} with commission $${preview.commissionTotal}.`
  });
  return { decision, order: await record(userId, order, "previewed"), preview };
}

// The Kairis order id doubles as the Coinbase client_order_id, so a retried submit cannot double-fill.
export async function submitAssisted(userId: string, orderId: string): Promise<AssistedOrder> {
  const order = await claimPreviewedOrder(orderId, userId);
  if (!order) {
    const existing = await getAssistedOrder(orderId, userId);
    if (!existing) {
      throw new Error("Order not found.");
    }
    throw new Error(existing.status !== "previewed" ? "Only a previewed order can be submitted." : "This order is already being submitted.");
  }
  const block = async (detail: string, riskDecision?: RiskDecision) =>
    record(
      userId,
      await updateAssistedOrder(order.id, {
        status: "blocked",
        reconcileState: "error",
        reconciledAt: new Date().toISOString(),
        detail,
        riskDecision
      }),
      "blocked"
    );

  if (Date.now() - Date.parse(order.createdAt) > PREVIEW_TTL_MS) {
    const expired = await updateAssistedOrder(order.id, {
      status: "expired",
      reconcileState: "reconciled",
      reconciledAt: new Date().toISOString(),
      detail: EXPIRED_DETAIL
    });
    await record(userId, expired, "expired");
    throw new Error(EXPIRED_DETAIL);
  }

  // Limits are re-checked at submit time: fills or a pause since the preview must win.
  const { decision } = await checkOrder(userId, {
    productId: order.productId,
    side: order.side,
    quoteUsd: order.quoteUsd,
    mode: "live",
    signalId: order.signalId
  });
  if (decision.outcome !== "approved") {
    return block(decision.reasons.join(" "), decision);
  }

  const client = await getExchangeClient(userId);
  if (client.provider !== order.provider) {
    return block(PROVIDER_CHANGED_DETAIL, decision);
  }
  if (client.provider === "coinbase" && !env.liveAssistedTradingEnabled) {
    return block(LIVE_DISABLED_DETAIL, decision);
  }

  let result: OrderSubmitResult;
  try {
    result = await client.createOrder({
      productId: order.productId,
      side: order.side,
      quoteUsd: order.quoteUsd,
      clientOrderId: order.id,
      previewId: order.previewId
    });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    const failed = await updateAssistedOrder(order.id, {
      status: "failed",
      reconcileState: "error",
      reconciledAt: new Date().toISOString(),
      detail: normalized.message
    });
    await record(userId, failed, "failed");
    throw new Error(normalized.message);
  }

  const submitted = await updateAssistedOrder(order.id, {
    status: result.success ? "submitted" : "failed",
    orderId: result.orderId,
    clientOrderId: order.id,
    reconcileState: result.success ? "pending" : "error",
    reconciledAt: result.success ? null : new Date().toISOString(),
    detail: result.detail,
    riskDecision: decision
  });
  return record(userId, submitted, submitted.status);
}

const TERMINAL: Partial<Record<OrderStatus["status"], "cancelled" | "expired" | "failed">> = {
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  FAILED: "failed"
};

function reconcilePatch(status: OrderStatus, now: string): AssistedOrderPatch {
  const fill = { filledSize: status.filledSize, averagePrice: status.averagePrice, totalFees: status.totalFees };
  if (status.status === "FILLED") {
    return {
      status: "filled",
      reconcileState: "reconciled",
      reconciledAt: now,
      exchangeStatus: status.raw,
      ...fill,
      detail: `Filled ${status.filledSize ?? "an unreported size"} at average $${status.averagePrice ?? "unreported"} (fees $${status.totalFees ?? 0}).`
    };
  }
  const terminal = TERMINAL[status.status];
  if (terminal) {
    const partial = (status.filledSize ?? 0) > 0 ? `; partially filled ${status.filledSize} at average $${status.averagePrice ?? "unreported"}` : "";
    return {
      status: terminal,
      reconcileState: "reconciled",
      reconciledAt: now,
      exchangeStatus: status.raw,
      ...fill,
      detail: `Exchange reported ${status.raw}${partial}.`
    };
  }
  if (status.status === "OPEN" || status.status === "PENDING") {
    return { exchangeStatus: status.raw };
  }
  return { reconcileState: "error", reconciledAt: now, exchangeStatus: status.raw, detail: UNKNOWN_STATUS_DETAIL };
}

export async function reconcileAssisted(userId: string): Promise<{ checked: number; updated: number }> {
  const pending = await listPendingAssistedOrders(userId);
  // Each order is checked with the provider that accepted it, not whatever is connected now.
  const clients = new Map<AssistedOrder["provider"], Promise<ExchangeClient>>();
  const clientFor = (provider: AssistedOrder["provider"]): Promise<ExchangeClient> => {
    let client = clients.get(provider);
    if (!client) {
      client =
        provider === "mock"
          ? Promise.resolve(createMockClient(getReferencePrice))
          : getExchangeClient(userId).then((c) => {
              if (c.provider !== "coinbase") {
                throw new Error("No Coinbase connection is available to reconcile this order; reconnect the exchange.");
              }
              return c;
            });
      clients.set(provider, client);
    }
    return client;
  };

  let checked = 0;
  let updated = 0;
  for (const order of pending) {
    if (!order.orderId) {
      continue;
    }
    checked += 1;
    const now = new Date().toISOString();
    try {
      const status = await (await clientFor(order.provider)).getOrder(order.orderId);
      const patch = reconcilePatch(status, now);
      await updateAssistedOrder(order.id, patch);
      if (patch.status !== undefined || patch.reconcileState !== undefined) {
        updated += 1;
      }
    } catch (error) {
      // A rate limit or provider outage leaves the order queued for the next pass; anything else
      // takes it out of the queue as an error so it is not retried blindly.
      const normalized = normalizeExchangeError(error);
      const message = errorMessage(error, normalized.message);
      if (normalized.retriable) {
        await updateAssistedOrder(order.id, { detail: `Reconcile will retry: ${message}` });
      } else {
        await updateAssistedOrder(order.id, { reconcileState: "error", reconciledAt: now, detail: message });
        updated += 1;
      }
    }
  }
  await appendAudit(userId, "operations", "reconcile-assisted-orders", `Checked ${checked}, updated ${updated}.`);
  return { checked, updated };
}
