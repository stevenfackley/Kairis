export type ExchangeProvider = "coinbase" | "mock";

export type ExchangeOrderInput = {
  productId: string;
  side: "BUY" | "SELL";
  quoteSize: number;
};

export type ExchangeOrderPreviewResult = {
  provider: ExchangeProvider;
  productId: string;
  side: "BUY" | "SELL";
  quoteSize: number;
  estimatedPrice: number;
  orderTotal: number;
  commissionTotal: number;
  warnings: string[];
  previewId: string;
};

export type ExchangeOrderSubmitResult = {
  provider: ExchangeProvider;
  success: boolean;
  orderId: string;
  clientOrderId: string;
  detail: string;
};
