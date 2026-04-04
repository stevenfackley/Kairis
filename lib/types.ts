export type ExecutionMode = "paper" | "manual" | "assisted" | "auto";

export type OnboardingState = {
  userId: string;
  preferredMode: ExecutionMode;
  riskAcknowledged: boolean;
  exchangeConnected: boolean;
  completedAt: string | null;
  updatedAt: string;
};

export type TradingLimits = {
  userId: string;
  maxPositionUsd: number;
  dailyLossCapUsd: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
  updatedAt: string;
};

export type PaperTrade = {
  id: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entryPrice: number;
  status: "planned" | "filled" | "blocked";
  note: string;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  userId: string;
  category: "onboarding" | "limits" | "paper-trade" | "export";
  action: string;
  detail: string;
  createdAt: string;
};

export type ExportArtifact = {
  id: string;
  userId: string;
  type: "paper-journal";
  storage: "r2" | "local";
  location: string;
  createdAt: string;
};

export type AssistedOrderRequest = {
  productId: string;
  side: "BUY" | "SELL";
  quoteSize: number;
};

export type AssistedOrderPreview = {
  provider: "coinbase" | "mock";
  productId: string;
  side: "BUY" | "SELL";
  quoteSize: number;
  estimatedPrice: number;
  orderTotal: number;
  commissionTotal: number;
  warnings: string[];
  previewId: string;
};

export type AssistedOrderRecord = {
  id: string;
  productId: string;
  side: "BUY" | "SELL";
  quoteSize: number;
  status: "previewed" | "submitted" | "blocked";
  reconcileState: "pending" | "reconciled" | "error";
  reconciledAt: string | null;
  provider: "coinbase" | "mock";
  detail: string;
  createdAt: string;
};

export type Phase4Snapshot = {
  onboarding: OnboardingState;
  limits: TradingLimits;
  paperTrades: PaperTrade[];
  auditEvents: AuditEvent[];
  exports: ExportArtifact[];
  assistedOrders: AssistedOrderRecord[];
  storage: {
    provider: "supabase" | "local";
    artifacts: "r2" | "local";
  };
};
