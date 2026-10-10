import { fillPaperOrder } from "@/lib/domain/paper";
import { appendAudit } from "@/lib/server/repos/audit";
import { insertPaperTrade } from "@/lib/server/repos/paper";
import { checkOrder } from "@/lib/server/services/risk";
import { storablePrice, storableUsd, unstorableFillReason } from "@/lib/server/services/shared";
import type { OrderIntent, PaperTrade, RiskDecision } from "@/lib/types";

export async function placePaperOrder(
  userId: string,
  intent: Omit<OrderIntent, "mode"> & { note?: string }
): Promise<{ trade: PaperTrade; decision: RiskDecision }> {
  const { note, ...rest } = intent;
  const order: OrderIntent = { ...rest, mode: "paper" };
  const { decision, context } = await checkOrder(userId, order);
  const base = {
    id: "",
    userId,
    productId: order.productId,
    side: order.side,
    quoteUsd: storableUsd(order.quoteUsd),
    signalId: order.signalId || null,
    riskDecision: decision,
    createdAt: ""
  };
  const userNote = note?.trim() ?? "";

  let trade: PaperTrade;
  let detail: string;
  if (decision.outcome !== "approved") {
    trade = await insertPaperTrade({
      ...base,
      status: "blocked",
      baseSize: 0,
      price: storablePrice(context.referencePrice),
      feeUsd: null,
      realizedPnlUsd: 0,
      note: userNote || decision.reasons.join(" ")
    });
    detail = `${order.side} ${order.productId} $${order.quoteUsd} ${decision.outcome}: ${decision.reasons.join(" ")}`;
  } else {
    const fill = fillPaperOrder(context.positions, order, context.referencePrice);
    const unstorable = unstorableFillReason(order.productId, fill);
    if (unstorable) {
      await appendAudit(userId, "paper-trade", "rejected", `${order.side} ${order.productId} $${order.quoteUsd}: ${unstorable}`);
      throw new Error(unstorable);
    }
    trade = await insertPaperTrade({ ...base, status: "filled", ...fill, note: userNote });
    detail =
      `${order.side} ${fill.baseSize} ${order.productId} at $${fill.price} ($${order.quoteUsd}), ` +
      `fee $${fill.feeUsd.toFixed(2)}, realized $${fill.realizedPnlUsd.toFixed(2)}.`;
  }
  await appendAudit(userId, "paper-trade", trade.status, detail);
  return { trade, decision };
}
