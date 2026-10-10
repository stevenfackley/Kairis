import { env } from "@/lib/env";
import { getProductRules } from "@/lib/exchange/coinbase-public";
import { normalizeExchangeError } from "@/lib/exchange/errors";
import { createMockClient } from "@/lib/exchange/mock";
import { describeSize, sizeMarketOrder } from "@/lib/exchange/sizing";
import type { ExchangeClient, OrderPreview, OrderStatus, OrderSubmitResult } from "@/lib/exchange/types";
import { num, usd } from "@/lib/format";
import {
  claimPreviewedOrder,
  expireStalePreviews,
  getAssistedOrder,
  insertAssistedOrder,
  listPendingAssistedOrders,
  releaseSubmitClaim,
  updateAssistedOrder,
  type AssistedOrderPatch
} from "@/lib/server/repos/assisted";
import { appendAudit } from "@/lib/server/repos/audit";
import { getConnectionStatus, getExchangeClient } from "@/lib/server/services/exchange-connection";
import { getReferencePrice } from "@/lib/server/services/market";
import { buildRiskContext, checkOrder } from "@/lib/server/services/risk";
import { errorMessage, loadProductRules, storableUsd, withFailedCheck } from "@/lib/server/services/shared";
import type { AssistedOrder, OrderIntent, RiskDecision } from "@/lib/types";

export const PREVIEW_TTL_MS = 120_000;
const EXPIRED_DETAIL = "Preview expired after 2 minutes; preview again.";
const ABANDONED_DETAIL = "Preview expired after 2 minutes without a submit; nothing was sent.";
const LIVE_DISABLED_DETAIL = "Live assisted trading is disabled by environment policy (ENABLE_LIVE_ASSISTED_TRADING=false).";
const PROVIDER_CHANGED_DETAIL = "The exchange connection changed since this preview; preview again.";
const NO_SIZE_DETAIL = "This preview has no recorded order size; preview again.";
const NO_TRADE_PERMISSION_DETAIL =
  "The connected Coinbase key has no trade permission. Create a trade-only key (no transfer permission) and reconnect.";
// An order Coinbase never acknowledged is searched for this long before Kairis calls it never placed.
const UNCONFIRMED_GIVE_UP_MS = 10 * 60_000;
const NOT_PLACED_DETAIL = "Coinbase has no order with this client order id 10 minutes on, so it was never placed.";
const NOT_FOUND_YET_DETAIL = "Coinbase has no order with this client order id yet; reconcile again in a minute.";

// Market IOC orders normally fill within a second of create: look once straight away and once shortly
// after, so the user sees the fill instead of a bare "submitted".
let settleDelayMs = 750;

/** Tests only: the pause before the second post-submit status check. */
export function __setSettleDelayMs(ms: number): void {
  settleDelayMs = ms;
}

const coins = (n: number) => num(n, 8);
const price = (n: number) => (n >= 1 ? usd(n) : `$${num(n, 8)}`);
const baseOf = (productId: string) => productId.split("-")[0] ?? productId;

const label = (o: Pick<AssistedOrder, "side" | "productId" | "quoteUsd">) => `${o.side} ${o.productId} ${usd(o.quoteUsd)}`;

async function record(userId: string, order: AssistedOrder, action: string): Promise<AssistedOrder> {
  await appendAudit(userId, "assisted-order", action, `${label(order)}: ${order.detail}`);
  return order;
}


/** The coins Coinbase reports available, 0 when the account holds none, null when unknown. */
async function availableBase(client: ExchangeClient, currency: string): Promise<number | null> {
  try {
    const balances = await client.balances();
    return balances.find((b) => b.currency === currency)?.available ?? 0;
  } catch {
    // The preview's errs still catch an oversized sell; an unreadable balance must not block it here.
    return null;
  }
}

const floorCents = (n: number) => Math.floor(n * 100) / 100;

/** A preview left behind (the user navigated away) would otherwise stay "previewed" forever. */
async function expireAbandoned(userId: string): Promise<void> {
  await expireStalePreviews(userId, new Date(Date.now() - PREVIEW_TTL_MS).toISOString(), ABANDONED_DETAIL);
}

/** closePosition sells the whole recorded position by coin amount; quoteUsd is then ignored. */
export type AssistedPreviewIntent = Omit<OrderIntent, "mode"> & { closePosition?: boolean };

export async function previewAssisted(
  userId: string,
  intent: AssistedPreviewIntent
): Promise<{ decision: RiskDecision; order: AssistedOrder; preview: OrderPreview | null }> {
  await expireAbandoned(userId);
  // Closing a position: the size is the held coins; the dollar figure (rounded down to the cent, so it
  // never exceeds the position) only feeds the risk checks and the record.
  let closeBase: number | null = null;
  let quoteUsd = intent.quoteUsd;
  if (intent.closePosition) {
    const held = await buildRiskContext(userId, "live", intent.productId);
    closeBase = Math.max(0, held.positions[intent.productId]?.baseSize ?? 0);
    quoteUsd = closeBase > 0 && held.referencePrice > 0 ? floorCents(closeBase * held.referencePrice) : 0;
  }
  const live: OrderIntent = {
    productId: intent.productId,
    side: intent.closePosition ? "SELL" : intent.side,
    quoteUsd,
    mode: "live",
    signalId: intent.signalId ?? null
  };
  const { decision, context } = await checkOrder(userId, live);
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
    orderSize: null,
    createdAt: "",
    updatedAt: ""
  };
  const block = async (detail: string, riskDecision: RiskDecision, extra: Partial<AssistedOrder> = {}) => {
    const order = await insertAssistedOrder({
      ...base,
      ...extra,
      status: "blocked",
      reconcileState: "error",
      reconciledAt: new Date().toISOString(),
      detail,
      riskDecision
    });
    return { decision: riskDecision, order: await record(userId, order, "blocked"), preview: null };
  };

  if (decision.outcome !== "approved") {
    return block(decision.reasons.join(" "), decision);
  }

  if (client.provider === "coinbase" && (await getConnectionStatus(userId))?.canTrade === false) {
    return block(NO_TRADE_PERMISSION_DETAIL, withFailedCheck(decision, "exchange-key", NO_TRADE_PERMISSION_DETAIL));
  }

  // Coinbase's own rules for this product (state, increments, minimums) size the order once, here.
  // Submit sends exactly this size, so the preview and the order can never disagree.
  const lookup = await loadProductRules(live.productId);
  if (!lookup.ok) {
    await appendAudit(userId, "assisted-order", "preview-failed", `${label(live)}: ${lookup.message}`);
    throw new Error(lookup.message);
  }
  const { rules } = lookup;
  const available = client.provider === "coinbase" && live.side === "SELL" ? await availableBase(client, rules.baseCurrency) : null;
  const sizing = sizeMarketOrder({ side: live.side, quoteUsd: live.quoteUsd, price: context.referencePrice, rules, availableBase: available, baseSize: closeBase });
  if (!sizing.ok) {
    return block(sizing.reason, withFailedCheck(decision, "exchange-rules", sizing.reason));
  }

  let preview: OrderPreview;
  try {
    preview = await client.previewOrder({ productId: live.productId, side: live.side, size: sizing.size });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    await appendAudit(userId, "assisted-order", "preview-failed", `${label(live)}: ${normalized.message}`);
    throw new Error(normalized.message);
  }

  // A non-empty errs list is Coinbase saying the order would be rejected: never offer it for submit.
  if (preview.errors.length > 0) {
    const detail = `Coinbase would reject this order: ${preview.errors.join(" ")}`;
    return block(detail, withFailedCheck(decision, "exchange-preview", detail), { orderSize: sizing.size, previewId: preview.previewId });
  }

  const order = await insertAssistedOrder({
    ...base,
    status: "previewed",
    reconcileState: "pending",
    reconciledAt: null,
    previewId: preview.previewId,
    orderSize: sizing.size,
    detail: [
      `Previewed: ${describeSize(sizing.size, live.productId)}, order total ${usd(preview.orderTotal)} including ${usd(preview.commissionTotal)} commission.`,
      intent.closePosition ? `Closing the whole ${live.productId} position.` : null,
      sizing.note
    ]
      .filter(Boolean)
      .join(" ")
  });
  return { decision, order: await record(userId, order, "previewed"), preview };
}

async function currentValue(productId: string, baseSize: string, fallback: number): Promise<number> {
  try {
    const mark = await getReferencePrice(productId);
    return mark > 0 ? floorCents(Number(baseSize) * mark) : fallback;
  } catch {
    return fallback;
  }
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

  type Gate =
    | { settled: AssistedOrder; client?: undefined; decision?: undefined; size?: undefined }
    | { settled?: undefined; client: ExchangeClient; decision: RiskDecision; size: NonNullable<AssistedOrder["orderSize"]> };
  const preflight = async (): Promise<Gate> => {
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
    if (!order.orderSize) {
      return { settled: await block(NO_SIZE_DETAIL) };
    }

    // Limits are re-checked at submit time: fills or a pause since the preview must win. A coin-sized
    // sell is valued at today's price: the coins sent are fixed, their dollar value is not.
    const quoteUsd = order.side === "SELL" && order.orderSize.kind === "base" ? await currentValue(order.productId, order.orderSize.baseSize, order.quoteUsd) : order.quoteUsd;
    const { decision } = await checkOrder(userId, {
      productId: order.productId,
      side: order.side,
      quoteUsd,
      mode: "live",
      signalId: order.signalId
    });
    if (decision.outcome !== "approved") {
      return { settled: await block(decision.reasons.join(" "), decision) };
    }

    const client = await getExchangeClient(userId);
    if (client.provider !== order.provider) {
      return { settled: await block(PROVIDER_CHANGED_DETAIL, decision) };
    }
    if (client.provider === "coinbase" && !env.liveAssistedTradingEnabled) {
      return { settled: await block(LIVE_DISABLED_DETAIL, decision) };
    }
    return { client, decision, size: order.orderSize };
  };

  // Until createOrder is reached nothing has left the building, so a throw here must free the claim.
  // After that point a retry could double-send, so the claim stays.
  let gate: Gate;
  try {
    gate = await preflight();
  } catch (error) {
    await releaseSubmitClaim(order.id, userId);
    throw error;
  }
  if (gate.settled) {
    return gate.settled;
  }
  const { client, decision, size } = gate;

  const fail = async (detail: string) =>
    record(
      userId,
      await updateAssistedOrder(order.id, {
        status: "failed",
        clientOrderId: order.id,
        reconcileState: "error",
        reconciledAt: new Date().toISOString(),
        detail,
        riskDecision: decision
      }),
      "failed"
    );
  // No answer is not a "no": the order may be on Coinbase. It stays submitted (so it counts toward the
  // limits) until a lookup by client_order_id settles it. It is never re-sent.
  const unconfirmed = async (reason: string) => {
    const pending = await updateAssistedOrder(order.id, {
      status: "submitted",
      orderId: null,
      clientOrderId: order.id,
      reconcileState: "pending",
      reconciledAt: null,
      detail: `Coinbase did not confirm the order (${reason.replace(/\.$/, "")}.) It may have been placed; Reconcile looks it up by its client order id.`,
      riskDecision: decision
    });
    return record(userId, pending, "unconfirmed");
  };

  let result: OrderSubmitResult;
  try {
    result = await client.createOrder({
      productId: order.productId,
      side: order.side,
      size,
      clientOrderId: order.id,
      previewId: order.previewId
    });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    return normalized.ambiguous ? unconfirmed(normalized.message) : fail(normalized.message);
  }
  if (!result.success) {
    // The documented answer to a repeated client_order_id is the existing order; treat this the same way.
    return result.failureReason === "DUPLICATE_CLIENT_ORDER_ID" ? unconfirmed("it reports this client order id as already used") : fail(result.detail);
  }

  const submitted = await updateAssistedOrder(order.id, {
    status: "submitted",
    orderId: result.orderId,
    clientOrderId: order.id,
    reconcileState: "pending",
    reconciledAt: null,
    detail: result.detail,
    riskDecision: decision
  });
  return record(userId, submitted, "submitted");
}

// Each order is checked with the provider that accepted it, not whatever is connected now.
async function clientForProvider(userId: string, provider: AssistedOrder["provider"]): Promise<ExchangeClient> {
  if (provider === "mock") {
    return createMockClient(getReferencePrice, undefined, getProductRules);
  }
  const client = await getExchangeClient(userId);
  if (client.provider !== "coinbase") {
    throw new Error("No Coinbase connection is available to reconcile this order; reconnect the exchange.");
  }
  return client;
}

/**
 * Right after a submit: records the fill when the exchange already reports it (market IOC orders
 * usually fill within a second), or finds an unconfirmed order by its client order id. Anything still
 * open is left for Reconcile. Never throws: the order is already on its way either way.
 */
export async function settleAssisted(userId: string, order: AssistedOrder): Promise<AssistedOrder> {
  if (order.status !== "submitted" || order.reconcileState !== "pending") {
    return order;
  }
  try {
    return await settle(await clientForProvider(userId, order.provider), order);
  } catch {
    return order;
  }
}

/** Looks up the exchange status of a submitted order: by order id, or by client order id when unconfirmed. */
async function exchangeStatus(client: ExchangeClient, order: AssistedOrder): Promise<OrderStatus | null> {
  if (order.orderId) {
    return client.getOrder(order.orderId);
  }
  const created = Date.parse(order.createdAt);
  return client.findOrderByClientId({
    clientOrderId: order.clientOrderId ?? order.id,
    productId: order.productId,
    side: order.side,
    createdAfter: new Date(created - 60_000).toISOString(),
    createdBefore: new Date(Math.max(Date.now(), created) + 60_000).toISOString()
  });
}

/** Records the fill of a just-submitted order when Coinbase already reports it; otherwise leaves it for reconcile. */
async function settle(client: ExchangeClient, order: AssistedOrder): Promise<AssistedOrder> {
  let current = order;
  for (const delay of [0, settleDelayMs]) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    let status: OrderStatus | null;
    try {
      status = await exchangeStatus(client, current);
    } catch {
      return current;
    }
    if (!status) {
      continue;
    }
    const patch = reconcilePatch(current, status, new Date().toISOString());
    current = await updateAssistedOrder(current.id, current.orderId ? patch : { ...patch, orderId: status.orderId });
    if (patch.status !== undefined) {
      return record(current.userId, current, current.status);
    }
  }
  return current;
}

const TERMINAL: Partial<Record<OrderStatus["status"], "cancelled" | "expired" | "failed">> = {
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  FAILED: "failed"
};

function fillText(order: Pick<AssistedOrder, "productId">, status: OrderStatus): string {
  const size = status.filledSize === null ? "an unreported size" : `${coins(status.filledSize)} ${baseOf(order.productId)}`;
  const avg = status.averagePrice === null ? "an unreported price" : `an average ${price(status.averagePrice)}`;
  return `${size} at ${avg}, fees ${usd(status.totalFees ?? 0)}`;
}

function reconcilePatch(order: Pick<AssistedOrder, "productId">, status: OrderStatus, now: string): AssistedOrderPatch {
  const fill = { filledSize: status.filledSize, averagePrice: status.averagePrice, totalFees: status.totalFees };
  const settled = { reconcileState: "reconciled" as const, reconciledAt: now, exchangeStatus: status.raw, ...fill };
  if (status.status === "FILLED") {
    return { ...settled, status: "filled", detail: `Filled ${fillText(order, status)}.` };
  }
  const terminal = TERMINAL[status.status];
  if (terminal) {
    // An IOC order that filled in part and then had its remainder cancelled moved real money: record it
    // as the fill it is, never as a zero (risk counts it either way, the user must see it).
    if ((status.filledSize ?? 0) > 0) {
      return { ...settled, status: "filled", detail: `Partially filled ${fillText(order, status)}; Coinbase reported ${status.raw} for the rest.` };
    }
    const why = status.message ? ` Coinbase says: ${status.message.replace(/[.\s]+$/, "")}.` : "";
    return { ...settled, status: terminal, detail: `Coinbase reported ${status.raw}; nothing was filled.${why}` };
  }
  if (status.status === "OPEN" || status.status === "PENDING") {
    return { exchangeStatus: status.raw };
  }
  // UNKNOWN_ORDER_STATUS or a status Kairis does not know: keep the order queued and ask again later.
  return { exchangeStatus: status.raw, detail: `Coinbase reported status ${status.raw || "(none)"}; reconcile again shortly.` };
}

export async function reconcileAssisted(userId: string): Promise<{ checked: number; updated: number }> {
  await expireAbandoned(userId);
  const pending = await listPendingAssistedOrders(userId);
  const clients = new Map<AssistedOrder["provider"], Promise<ExchangeClient>>();
  const clientFor = (provider: AssistedOrder["provider"]): Promise<ExchangeClient> => {
    let client = clients.get(provider);
    if (!client) {
      client = clientForProvider(userId, provider);
      clients.set(provider, client);
    }
    return client;
  };

  let checked = 0;
  let updated = 0;
  for (const order of pending) {
    checked += 1;
    const now = new Date().toISOString();
    try {
      const status = await exchangeStatus(await clientFor(order.provider), order);
      if (!status) {
        // Unconfirmed and not on Coinbase: give it a few minutes (listing can lag), then close it out.
        const gaveUp = Date.now() - Date.parse(order.createdAt) > UNCONFIRMED_GIVE_UP_MS;
        await updateAssistedOrder(
          order.id,
          gaveUp ? { status: "failed", reconcileState: "reconciled", reconciledAt: now, detail: NOT_PLACED_DETAIL } : { detail: NOT_FOUND_YET_DETAIL }
        );
        if (gaveUp) updated += 1;
        continue;
      }
      const patch = reconcilePatch(order, status, now);
      await updateAssistedOrder(order.id, order.orderId ? patch : { ...patch, orderId: status.orderId });
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
