import type {
  ExchangeOrderInput,
  ExchangeOrderPreviewResult,
  ExchangeOrderSubmitResult
} from "@/lib/exchange/types";

const referencePrices: Record<string, number> = {
  "BTC-USD": 68250,
  "ETH-USD": 3430,
  "SOL-USD": 188
};

function getReferencePrice(productId: string) {
  return referencePrices[productId] ?? 100;
}

export async function previewMockOrder(
  input: ExchangeOrderInput
): Promise<ExchangeOrderPreviewResult> {
  const feeRate = 0.006;
  const estimatedPrice = getReferencePrice(input.productId);

  return {
    provider: "mock",
    productId: input.productId,
    side: input.side,
    quoteSize: input.quoteSize,
    estimatedPrice,
    orderTotal: input.quoteSize,
    commissionTotal: Number((input.quoteSize * feeRate).toFixed(2)),
    warnings: [
      "Mock provider active. No live order will be sent.",
      "Configure Coinbase credentials and enable assisted live trading to submit real previews and orders."
    ],
    previewId: crypto.randomUUID()
  };
}

export async function submitMockOrder(
  input: ExchangeOrderInput
): Promise<ExchangeOrderSubmitResult> {
  return {
    provider: "mock",
    success: true,
    orderId: crypto.randomUUID(),
    clientOrderId: crypto.randomUUID(),
    detail: `Mock assisted order accepted for ${input.side} ${input.productId} with quote size ${input.quoteSize}.`
  };
}
