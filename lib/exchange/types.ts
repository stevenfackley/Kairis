import type { OrderSize, ProductId, Side } from "@/lib/types";

export type { OrderSize } from "@/lib/types";
export type { ProductRules } from "@/lib/exchange/sizing";

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

/** A market IOC order. SELL must be sized in base (coins); Coinbase refuses quote_size for market sells. */
export type OrderInput = { productId: ProductId; side: Side; size: OrderSize };

export type OrderPreview = {
  previewId: string | null;
  orderTotal: number;
  commissionTotal: number;
  bestBid: number | null;
  bestAsk: number | null;
  /** What Coinbase computed for the order, in coins and dollars. */
  baseSize: number | null;
  quoteSize: number | null;
  /** From `errs`: why Coinbase would reject this order. Non-empty means the order must not be submitted. */
  errors: string[];
  warnings: string[];
};

export type OrderSubmitResult = {
  success: boolean;
  orderId: string | null;
  clientOrderId: string;
  detail: string;
  /** new_order_failure_reason (or the deprecated fields) when Coinbase rejected the order. */
  failureReason: string | null;
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
