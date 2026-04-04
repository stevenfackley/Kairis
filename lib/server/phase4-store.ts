import { env } from "@/lib/env";
import {
  createAuditEvent,
  demoUserId,
  getDefaultOnboardingState,
  getDefaultTradingLimits,
  getSeedPaperTrades
} from "@/lib/defaults";
import type {
  AuditEvent,
  ExportArtifact,
  OnboardingState,
  PaperTrade,
  Phase4Snapshot,
  TradingLimits
} from "@/lib/types";
import { writeArtifactFile, readJsonFile, writeJsonFile } from "@/lib/server/storage";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const storeKeys = {
  onboarding: "onboarding.json",
  limits: "limits.json",
  trades: "paper-trades.json",
  audits: "audit-events.json",
  exports: "exports.json"
} as const;

async function readLocalOnboarding() {
  return readJsonFile<OnboardingState>(storeKeys.onboarding, getDefaultOnboardingState());
}

async function readLocalLimits() {
  return readJsonFile<TradingLimits>(storeKeys.limits, getDefaultTradingLimits());
}

async function readLocalTrades() {
  return readJsonFile<PaperTrade[]>(storeKeys.trades, getSeedPaperTrades());
}

async function readLocalAudits() {
  return readJsonFile<AuditEvent[]>(
    storeKeys.audits,
    [createAuditEvent("onboarding", "bootstrap", "Initialized local Phase 4 store.")]
  );
}

async function readLocalExports() {
  return readJsonFile<ExportArtifact[]>(storeKeys.exports, []);
}

async function appendAuditEvent(event: AuditEvent) {
  const events = await readLocalAudits();
  events.unshift(event);
  await writeJsonFile(storeKeys.audits, events.slice(0, 50));
}

async function getLocalSnapshot(): Promise<Phase4Snapshot> {
  const [onboarding, limits, paperTrades, auditEvents, exports] = await Promise.all([
    readLocalOnboarding(),
    readLocalLimits(),
    readLocalTrades(),
    readLocalAudits(),
    readLocalExports()
  ]);

  return {
    onboarding,
    limits,
    paperTrades,
    auditEvents,
    exports,
    storage: {
      provider: "local",
      artifacts: env.r2Configured ? "r2" : "local"
    }
  };
}

async function getSupabaseSnapshot(): Promise<Phase4Snapshot | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  const [
    onboardingResult,
    limitsResult,
    tradesResult,
    auditsResult,
    exportsResult
  ] = await Promise.all([
    supabase.from("onboarding_states").select("*").eq("user_id", demoUserId).maybeSingle(),
    supabase.from("trading_limits").select("*").eq("user_id", demoUserId).maybeSingle(),
    supabase
      .from("paper_trades")
      .select("*")
      .eq("user_id", demoUserId)
      .order("created_at", { ascending: false }),
    supabase
      .from("audit_events")
      .select("*")
      .eq("user_id", demoUserId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("export_artifacts")
      .select("*")
      .eq("user_id", demoUserId)
      .order("created_at", { ascending: false })
  ]);

  if (
    onboardingResult.error ||
    limitsResult.error ||
    tradesResult.error ||
    auditsResult.error ||
    exportsResult.error
  ) {
    return null;
  }

  return {
    onboarding: onboardingResult.data
      ? {
          userId: onboardingResult.data.user_id,
          preferredMode: onboardingResult.data.preferred_mode,
          riskAcknowledged: onboardingResult.data.risk_acknowledged,
          exchangeConnected: onboardingResult.data.exchange_connected,
          completedAt: onboardingResult.data.completed_at,
          updatedAt: onboardingResult.data.updated_at
        }
      : getDefaultOnboardingState(),
    limits: limitsResult.data
      ? {
          userId: limitsResult.data.user_id,
          maxPositionUsd: limitsResult.data.max_position_usd,
          dailyLossCapUsd: limitsResult.data.daily_loss_cap_usd,
          maxTradesPerDay: limitsResult.data.max_trades_per_day,
          cooldownMinutes: limitsResult.data.cooldown_minutes,
          updatedAt: limitsResult.data.updated_at
        }
      : getDefaultTradingLimits(),
    paperTrades:
      tradesResult.data?.map((trade) => ({
        id: trade.id,
        userId: trade.user_id,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        entryPrice: trade.entry_price,
        status: trade.status,
        note: trade.note,
        createdAt: trade.created_at
      })) ?? [],
    auditEvents:
      auditsResult.data?.map((event) => ({
        id: event.id,
        userId: event.user_id,
        category: event.category,
        action: event.action,
        detail: event.detail,
        createdAt: event.created_at
      })) ?? [],
    exports:
      exportsResult.data?.map((artifact) => ({
        id: artifact.id,
        userId: artifact.user_id,
        type: artifact.type,
        storage: artifact.storage,
        location: artifact.location,
        createdAt: artifact.created_at
      })) ?? [],
    storage: {
      provider: "supabase",
      artifacts: env.r2Configured ? "r2" : "local"
    }
  };
}

export async function getPhase4Snapshot(): Promise<Phase4Snapshot> {
  const snapshot = await getSupabaseSnapshot();
  if (snapshot) {
    return snapshot;
  }

  return getLocalSnapshot();
}

export async function saveOnboardingState(
  input: Pick<
    OnboardingState,
    "preferredMode" | "riskAcknowledged" | "exchangeConnected"
  >
) {
  const timestamp = new Date().toISOString();
  const completedAt = input.riskAcknowledged ? timestamp : null;
  const nextState: OnboardingState = {
    userId: demoUserId,
    preferredMode: input.preferredMode,
    riskAcknowledged: input.riskAcknowledged,
    exchangeConnected: input.exchangeConnected,
    completedAt,
    updatedAt: timestamp
  };

  await writeJsonFile(storeKeys.onboarding, nextState);
  await appendAuditEvent(
    createAuditEvent(
      "onboarding",
      "saved",
      `Preferred mode set to ${input.preferredMode}; exchange connected: ${input.exchangeConnected}.`
    )
  );

  return nextState;
}

export async function saveTradingLimits(
  input: Omit<TradingLimits, "userId" | "updatedAt">
) {
  const nextLimits: TradingLimits = {
    userId: demoUserId,
    ...input,
    updatedAt: new Date().toISOString()
  };

  await writeJsonFile(storeKeys.limits, nextLimits);
  await appendAuditEvent(
    createAuditEvent(
      "limits",
      "saved",
      `Limits updated: max position ${input.maxPositionUsd}, daily loss cap ${input.dailyLossCapUsd}.`
    )
  );

  return nextLimits;
}

export async function addPaperTrade(
  input: Omit<PaperTrade, "id" | "userId" | "createdAt">
) {
  const trades = await readLocalTrades();
  const trade: PaperTrade = {
    id: crypto.randomUUID(),
    userId: demoUserId,
    ...input,
    createdAt: new Date().toISOString()
  };

  trades.unshift(trade);
  await writeJsonFile(storeKeys.trades, trades.slice(0, 50));
  await appendAuditEvent(
    createAuditEvent(
      "paper-trade",
      "created",
      `${trade.side.toUpperCase()} ${trade.symbol} at ${trade.entryPrice}.`
    )
  );

  return trade;
}

export async function createPaperJournalExport() {
  const trades = await readLocalTrades();
  const csvLines = [
    "id,symbol,side,quantity,entryPrice,status,note,createdAt",
    ...trades.map((trade) =>
      [
        trade.id,
        trade.symbol,
        trade.side,
        trade.quantity,
        trade.entryPrice,
        trade.status,
        `"${trade.note.replaceAll('"', '""')}"`,
        trade.createdAt
      ].join(",")
    )
  ];

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `paper-journal-${timestamp}.csv`;
  const location = await writeArtifactFile(fileName, csvLines.join("\n"));

  const artifact: ExportArtifact = {
    id: crypto.randomUUID(),
    userId: demoUserId,
    type: "paper-journal",
    storage: env.r2Configured ? "r2" : "local",
    location: env.r2Configured ? `r2://${process.env.R2_BUCKET}/${fileName}` : location,
    createdAt: new Date().toISOString()
  };

  const artifacts = await readLocalExports();
  artifacts.unshift(artifact);
  await writeJsonFile(storeKeys.exports, artifacts.slice(0, 20));
  await appendAuditEvent(
    createAuditEvent(
      "export",
      "created",
      `Paper journal export created at ${artifact.location}.`
    )
  );

  return artifact;
}
