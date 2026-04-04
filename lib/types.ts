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

export type Phase4Snapshot = {
  onboarding: OnboardingState;
  limits: TradingLimits;
  paperTrades: PaperTrade[];
  auditEvents: AuditEvent[];
  exports: ExportArtifact[];
  storage: {
    provider: "supabase" | "local";
    artifacts: "r2" | "local";
  };
};
