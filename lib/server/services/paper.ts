import { usdPrice } from "@/lib/domain/money";
import { fillPaperOrder, type PaperFillOptions } from "@/lib/domain/paper";
import { sizeMarketOrder } from "@/lib/exchange/sizing";
import { num, usd } from "@/lib/format";
import { appendAudit } from "@/lib/server/repos/audit";
import { insertPaperTrade } from "@/lib/server/repos/paper";
import { checkOrder } from "@/lib/server/services/risk";
import { loadProductRules, storablePrice, storableUsd, unstorableFillReason, withFailedCheck } from "@/lib/server/services/shared";
import type { OrderIntent, PaperTrade, RiskDecision } from "@/lib/types";

/**
 * Risk-checks, sizes and simulates one paper order the way a live order is handled, so switching to live
 * holds no surprise: the same risk engine, then Coinbase's rules for the product (market-order state,
 * increments, minimums and maximums) applied by the same sizeMarketOrder live orders use. A BUY spends its
 * dollars floored to quote_increment; a SELL sells coins floored to base_increment (fillPaperOrder has the
 * dust rule). Anything that stops the order is still recorded with its reasons: a size or product state
 * Coinbase would refuse blocks it, a product Coinbase does not list blocks it, and product rules that
 * cannot be loaded (an outage) halt it, as they stop a live order.
 * `sellAll` sells the whole held position of the product (its dollar size comes from the position at the
 * current price) and leaves no dust behind.
 */
export async function placePaperOrder(
  userId: string,
  intent: Omit<OrderIntent, "mode"> & { note?: string; sellAll?: boolean }
): Promise<{ trade: PaperTrade; decision: RiskDecision }> {
  const { note, sellAll, ...rest } = intent;
  const closePosition = sellAll === true;
  const checked = await checkOrder(userId, { ...rest, mode: "paper" }, { closePosition });
  const { context } = checked;
  const order = checked.intent;
  let decision = checked.decision;

  let sized: PaperFillOptions | null = null;
  if (decision.outcome === "approved") {
    const lookup = await loadProductRules(order.productId);
    if (!lookup.ok) {
      decision = lookup.unknownProduct
        ? withFailedCheck(decision, "tradable-product", lookup.message)
        : withFailedCheck(decision, "exchange-rules", lookup.message, "halted");
    } else {
      const held = context.positions[order.productId];
      const sizing = sizeMarketOrder({
        side: order.side,
        quoteUsd: order.quoteUsd,
        price: context.referencePrice,
        rules: lookup.rules,
        baseSize: closePosition ? (held?.baseSize ?? 0) : null
      });
      if (sizing.ok) {
        sized = { closePosition, size: sizing.size, baseIncrement: lookup.rules.baseIncrement };
      } else {
        decision = withFailedCheck(decision, "exchange-rules", sizing.reason);
      }
    }
  }

  // A buy records the dollars it actually spends: the quote floored to the product's quote_increment.
  const quoteUsd = sized?.size?.kind === "quote" ? Number(sized.size.quoteSize) : order.quoteUsd;
  const base = {
    id: "",
    userId,
    productId: order.productId,
    side: order.side,
    quoteUsd: storableUsd(quoteUsd),
    signalId: order.signalId || null,
    riskDecision: decision,
    createdAt: ""
  };
  const userNote = note?.trim() ?? "";

  let trade: PaperTrade;
  let detail: string;
  if (!sized) {
    trade = await insertPaperTrade({
      ...base,
      status: "blocked",
      baseSize: 0,
      price: storablePrice(context.referencePrice),
      feeUsd: null,
      realizedPnlUsd: 0,
      note: userNote || decision.reasons.join(" ")
    });
    detail = `${order.side} ${order.productId} ${usd(order.quoteUsd)} ${decision.outcome}: ${decision.reasons.join(" ")}`;
  } else {
    const fill = fillPaperOrder(context.positions, order, context.referencePrice, undefined, sized);
    const unstorable = unstorableFillReason(order.productId, fill);
    if (unstorable) {
      await appendAudit(userId, "paper-trade", "rejected", `${order.side} ${order.productId} ${usd(quoteUsd)}: ${unstorable}`);
      throw new Error(unstorable);
    }
    trade = await insertPaperTrade({ ...base, status: "filled", ...fill, note: userNote });
    const filledValue = fill.baseSize * fill.price;
    detail =
      `${order.side} ${num(fill.baseSize, 8)} ${order.productId} at ${usdPrice(fill.price)}: ` +
      (order.side === "BUY"
        ? `spent ${usd(filledValue + fill.feeUsd)} including a ${usd(fill.feeUsd)} fee.`
        : `proceeds ${usd(filledValue - fill.feeUsd)} after a ${usd(fill.feeUsd)} fee, realized ${usd(fill.realizedPnlUsd)}.`);
  }
  await appendAudit(userId, "paper-trade", trade.status, detail);
  return { trade, decision };
}
