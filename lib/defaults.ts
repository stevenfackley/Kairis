import type {
  AuditEvent,
  OnboardingState,
  PaperTrade,
  TradingLimits
} from "@/lib/types";

export const demoUserId = "demo-user";

export function getDefaultOnboardingState(): OnboardingState {
  return {
    userId: demoUserId,
    preferredMode: "paper",
    riskAcknowledged: false,
    exchangeConnected: false,
    completedAt: null,
    updatedAt: new Date().toISOString()
  };
}

export function getDefaultTradingLimits(): TradingLimits {
  return {
    userId: demoUserId,
    maxPositionUsd: 1500,
    dailyLossCapUsd: 300,
    maxTradesPerDay: 6,
    cooldownMinutes: 20,
    updatedAt: new Date().toISOString()
  };
}

export function getSeedPaperTrades(): PaperTrade[] {
  return [
    {
      id: "paper-1",
      userId: demoUserId,
      symbol: "ETH-USD",
      side: "buy",
      quantity: 0.45,
      entryPrice: 3420,
      status: "planned",
      note: "Phase 4 seed trade for the paper journal.",
      createdAt: new Date().toISOString()
    }
  ];
}

export function createAuditEvent(
  category: AuditEvent["category"],
  action: string,
  detail: string
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    userId: demoUserId,
    category,
    action,
    detail,
    createdAt: new Date().toISOString()
  };
}
