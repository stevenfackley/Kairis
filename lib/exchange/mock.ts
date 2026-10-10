import { describeOrderFailure, describePreviewFailure } from "@/lib/exchange/reasons";
import { sizeViolations, type ProductRules } from "@/lib/exchange/sizing";
import type { ExchangeClient, OrderInput, OrderStatus } from "@/lib/exchange/types";

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const COMMISSION_RATE = 0.006;

const issued = new Map<string, OrderStatus>();
// client_order_id -> order id: a repeated create returns the existing order, as Coinbase does.
const byClientId = new Map<string, string>();

/**
 * Simulated exchange. When given the product rules loader it enforces the same sizing rules Coinbase
 * does (increments, minimums, market-order availability), so mock users meet the same refusals.
 */
export function createMockClient(
  referencePrice: (productId: string) => Promise<number>,
  idFactory: () => string = () => crypto.randomUUID(),
  productRules?: (productId: string) => Promise<ProductRules>
): ExchangeClient {
  async function violations(input: OrderInput): Promise<string[]> {
    const rules = productRules ? await productRules(input.productId) : null;
    if (rules) return sizeViolations(input.side, input.size, rules);
    return input.side === "SELL" && input.size.kind !== "base" ? ["PREVIEW_INVALID_ORDER_CONFIG"] : [];
  }

  // Mirrors Coinbase: a quote-sized market BUY spends exactly quote_size INCLUDING the fee
  // (size_inclusive_of_fees: true, total_value_after_fees = filled_value + total_fees = quote_size), and the
  // fee is charged on the filled value. A base-sized SELL is charged on its proceeds
  // (total_value_after_fees = filled_value - total_fees).
  async function economics(input: OrderInput) {
    const price = await referencePrice(input.productId);
    if (input.size.kind === "quote") {
      const gross = Number(input.size.quoteSize);
      const filledValue = gross / (1 + COMMISSION_RATE);
      return { price, baseSize: round8(filledValue / price), commission: round8(gross - filledValue), orderTotal: gross, quoteSize: gross };
    }
    const baseSize = Number(input.size.baseSize);
    const filledValue = baseSize * price;
    const commission = round8(filledValue * COMMISSION_RATE);
    const side = input.side === "SELL" ? -1 : 1;
    return { price, baseSize, commission, orderTotal: round8(filledValue + side * commission), quoteSize: round8(filledValue) };
  }

  return {
    provider: "mock",
    async keyPermissions() {
      return { canView: true, canTrade: false, canTransfer: false, portfolioUuid: null, portfolioType: null };
    },
    async balances() {
      return [{ currency: "USD", available: 10000 }];
    },
    async previewOrder(input) {
      const errs = await violations(input);
      const { price, baseSize, commission, orderTotal, quoteSize } = await economics(input);
      return {
        previewId: idFactory(),
        orderTotal,
        commissionTotal: commission,
        bestBid: price * 0.9995,
        bestAsk: price * 1.0005,
        baseSize,
        quoteSize,
        errors: errs.map(describePreviewFailure),
        warnings: ["Mock provider active: no live order will be sent."]
      };
    },
    async createOrder(input) {
      const existing = byClientId.get(input.clientOrderId);
      if (existing) {
        return { success: true, orderId: existing, clientOrderId: input.clientOrderId, failureReason: null, detail: "Mock order already exists for this client order id." };
      }
      const errs = await violations(input);
      if (errs.length > 0) {
        const reason = errs[0]!.replace(/^PREVIEW_/, "");
        return {
          success: false,
          orderId: null,
          clientOrderId: input.clientOrderId,
          failureReason: reason,
          detail: `Coinbase rejected the order. ${describeOrderFailure(reason)}`
        };
      }
      const { price, baseSize, commission } = await economics(input);
      const orderId = idFactory();
      issued.set(orderId, { orderId, status: "FILLED", filledSize: baseSize, averagePrice: price, totalFees: commission, raw: "FILLED" });
      byClientId.set(input.clientOrderId, orderId);
      const sized = input.size.kind === "quote" ? `quote size ${input.size.quoteSize}` : `base size ${input.size.baseSize}`;
      return {
        success: true,
        orderId,
        clientOrderId: input.clientOrderId,
        failureReason: null,
        detail: `Mock order accepted for ${input.side} ${input.productId} with ${sized}.`
      };
    },
    async getOrder(orderId) {
      return (
        issued.get(orderId) ?? {
          orderId,
          status: "UNKNOWN",
          filledSize: null,
          averagePrice: null,
          totalFees: null,
          raw: "UNKNOWN"
        }
      );
    }
  };
}
