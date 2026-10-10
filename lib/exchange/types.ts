import type { ProductId, Side } from "@/lib/types";

export type ExchangeProviderName = "coinbase" | "mock";

export type KeyPermissions = {
  canView: boolean;
  canTrade: boolean;
  canTransfer: boolean;
  portfolioUuid: string | null;
  /** DEFAULT, CONSUMER or INTX for a portfolio-scoped key; null when Coinbase does not say. */
  portfolioType: string | null;
};

export type Balance = { currency: string; available: number };

export type OrderInput = { productId: ProductId; side: Side; quoteUsd: number };

export type OrderPreview = {
  previewId: string | null;
  orderTotal: number;
  commissionTotal: number;
  bestBid: number | null;
  bestAsk: number | null;
  warnings: string[];
};

export type OrderSubmitResult = {
  success: boolean;
  orderId: string | null;
  clientOrderId: string;
  detail: string;
};

export type ExchangeOrderStatus =
  | "OPEN"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED"
  | "PENDING"
  | "UNKNOWN";

export type OrderStatus = {
  orderId: string;
  status: ExchangeOrderStatus;
  filledSize: number | null;
  averagePrice: number | null;
  totalFees: number | null;
  raw: string;
};

export interface ExchangeClient {
  provider: ExchangeProviderName;
  keyPermissions(): Promise<KeyPermissions>;
  balances(): Promise<Balance[]>;
  previewOrder(input: OrderInput): Promise<OrderPreview>;
  createOrder(
    input: OrderInput & { clientOrderId: string; previewId?: string | null }
  ): Promise<OrderSubmitResult>;
  getOrder(orderId: string): Promise<OrderStatus>;
}

export type FetchLike = typeof fetch;
