export type ExecutionMode = "paper" | "manual" | "assisted" | "auto";
export type TradeMode = "paper" | "live";
export type Side = "BUY" | "SELL";
export type ProductId = string;

export type Candle = { start: number; open: number; high: number; low: number; close: number; volume: number };
export type Ticker = { productId: ProductId; price: number; bestBid: number; bestAsk: number; tradeTime: number };

export type SignalAction = "long" | "observe" | "blocked";
export type SignalEvaluation = {
  productId: ProductId;
  action: SignalAction;
  setup: string;
  rationale: string[];
  strength: number;
  referencePrice: number;
  atrPct: number | null;
  rsi: number | null;
  spreadPct: number | null;
  dataAgeMs: number;
  evaluatedAt: string;
};
export type SignalRecord = SignalEvaluation & { id: string };

export type TradingLimits = {
  userId: string;
  maxPositionUsd: number;
  dailyLossCapUsd: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
  lossStreakTrigger: number;
  perSymbolMaxUsd: Record<string, number>;
  tradingPaused: boolean;
  updatedAt: string;
};

export type OrderIntent = { productId: ProductId; side: Side; quoteUsd: number; mode: TradeMode; signalId?: string | null };

export type RiskCheck = { code: string; passed: boolean; detail: string };
export type RiskOutcome = "approved" | "blocked" | "halted";
export type RiskDecision = { outcome: RiskOutcome; checks: RiskCheck[]; reasons: string[]; evaluatedAt: string };

export type DayStats = { tradesCount: number; realizedPnlUsd: number; consecutiveLosses: number; lastLossAt: string | null };
export type Position = { baseSize: number; avgCost: number; notionalUsd: number };
export type PositionMap = Record<ProductId, Position>;

export type RiskContext = {
  limits: TradingLimits;
  today: DayStats;
  positions: PositionMap;
  referencePrice: number;
  dataAgeMs: number;
  maxDataAgeMs: number;
  providerDegraded: boolean;
  /** Coinbase does not list the product (its market endpoints answered "not found"): blocked, not halted. */
  unknownProduct?: boolean;
  now: Date;
};

export type PaperTradeStatus = "filled" | "blocked";
export type PaperTrade = {
  id: string; userId: string; productId: ProductId; side: Side; baseSize: number; price: number; quoteUsd: number;
  /** Simulated taker fee in USD; null on blocked rows and on fills recorded before fees were modeled. */
  feeUsd: number | null;
  status: PaperTradeStatus; realizedPnlUsd: number; note: string; signalId: string | null; riskDecision: RiskDecision | null; createdAt: string;
};

/** How a market order is sized on Coinbase: dollars for a BUY (quote_size), coins for a SELL (base_size). */
export type OrderSize = { kind: "quote"; quoteSize: string } | { kind: "base"; baseSize: string };

export type AssistedStatus ="previewed" | "submitted" | "blocked" | "filled" | "cancelled" | "failed" | "expired";
export type ReconcileState = "pending" | "reconciled" | "error";
export type AssistedOrder = {
  id: string; userId: string; productId: ProductId; side: Side; quoteUsd: number; status: AssistedStatus; reconcileState: ReconcileState;
  reconciledAt: string | null; provider: "coinbase" | "mock"; detail: string; orderId: string | null; clientOrderId: string | null;
  previewId: string | null; exchangeStatus: string | null; filledSize: number | null; averagePrice: number | null; totalFees: number | null;
  signalId: string | null; riskDecision: RiskDecision | null; createdAt: string; updatedAt: string;
  /** The exact size previewed; submit sends this, never a re-computed one. */
  orderSize?: OrderSize | null;
};

export type AuditCategory = "auth" | "onboarding" | "limits" | "signal" | "risk" | "paper-trade" | "assisted-order" | "exchange" | "export" | "operations" | "auto";
export type AuditEvent = { id: string; userId: string; category: AuditCategory; action: string; detail: string; createdAt: string };

export type ExchangeConnection = {
  userId: string; provider: "coinbase"; keyId: string; canView: boolean; canTrade: boolean; canTransfer: boolean;
  portfolioUuid: string | null; portfolioType?: string | null; validatedAt: string; createdAt: string;
};

export type ExportType = "paper-journal" | "assisted-orders" | "audit-log";
export type ExportArtifact = { id: string; userId: string; type: ExportType; storage: "r2" | "local"; location: string; createdAt: string };

export type UserRecord = { id: string; email: string | null; displayName: string | null; isOwner: boolean; createdAt: string; lastSeenAt: string };
export type OnboardingState = { userId: string; preferredMode: ExecutionMode; riskAcknowledged: boolean; exchangeConnected: boolean; completedAt: string | null; updatedAt: string };
