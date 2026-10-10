import type { ExchangeClient, OrderInput, OrderStatus } from "@/lib/exchange/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

const issued = new Map<string, OrderStatus>();

export function createMockClient(
  referencePrice: (productId: string) => Promise<number>,
  idFactory: () => string = () => crypto.randomUUID()
): ExchangeClient {
  const commission = (input: OrderInput) => round2(input.quoteUsd * 0.006);

  return {
    provider: "mock",
    async keyPermissions() {
      return { canView: true, canTrade: false, canTransfer: false, portfolioUuid: null, portfolioType: null };
    },
    async balances() {
      return [{ currency: "USD", available: 10000 }];
    },
    async previewOrder(input) {
      const price = await referencePrice(input.productId);
      return {
        previewId: idFactory(),
        orderTotal: input.quoteUsd,
        commissionTotal: commission(input),
        bestBid: price * 0.9995,
        bestAsk: price * 1.0005,
        warnings: ["Mock provider active: no live order will be sent."]
      };
    },
    async createOrder(input) {
      const price = await referencePrice(input.productId);
      const orderId = idFactory();
      issued.set(orderId, {
        orderId,
        status: "FILLED",
        filledSize: input.quoteUsd / price,
        averagePrice: price,
        totalFees: commission(input),
        raw: "FILLED"
      });
      return {
        success: true,
        orderId,
        clientOrderId: input.clientOrderId,
        detail: `Mock order accepted for ${input.side} ${input.productId} with quote size ${input.quoteUsd}.`
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
