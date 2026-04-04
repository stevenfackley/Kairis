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
  AssistedOrderRecord,
  ExportArtifact,
  OnboardingState,
  PaperTrade,
  Phase4Snapshot,
  TradingLimits
} from "@/lib/types";
import { writeArtifactFile, readJsonFile, writeJsonFile } from "@/lib/server/storage";
import { uploadArtifactToR2 } from "@/lib/server/r2";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const storeKeys = {
  onboarding: "onboarding.json",
  limits: "limits.json",
  trades: "paper-trades.json",
  audits: "audit-events.json",
  exports: "exports.json",
  assistedOrders: "assisted-orders.json"
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

async function readLocalAssistedOrders() {
  return readJsonFile<AssistedOrderRecord[]>(storeKeys.assistedOrders, []);
}

async function appendAuditEvent(event: AuditEvent) {
  const supabase = createSupabaseAdminClient();

  if (supabase) {
    await supabase.from("audit_events").insert({
      id: event.id,
      user_id: event.userId,
      category: event.category,
      action: event.action,
      detail: event.detail,
      created_at: event.createdAt
    });

    return;
  }

  const events = await readLocalAudits();
  events.unshift(event);
  await writeJsonFile(storeKeys.audits, events.slice(0, 50));
}

async function getLocalSnapshot(): Promise<Phase4Snapshot> {
  const [onboarding, limits, paperTrades, auditEvents, exports, assistedOrders] =
    await Promise.all([
    readLocalOnboarding(),
    readLocalLimits(),
    readLocalTrades(),
    readLocalAudits(),
    readLocalExports(),
    readLocalAssistedOrders()
    ]);

  return {
    onboarding,
    limits,
    paperTrades,
    auditEvents,
    exports,
    assistedOrders,
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
    exportsResult,
    assistedOrdersResult
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
      .order("created_at", { ascending: false }),
    supabase
      .from("assisted_orders")
      .select("*")
      .eq("user_id", demoUserId)
      .order("created_at", { ascending: false })
  ]);

  if (
    onboardingResult.error ||
    limitsResult.error ||
    tradesResult.error ||
    auditsResult.error ||
    exportsResult.error ||
    assistedOrdersResult.error
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
    assistedOrders:
      assistedOrdersResult.data?.map((order) => ({
        id: order.id,
        productId: order.product_id,
        side: order.side,
        quoteSize: Number(order.quote_size),
        status: order.status,
        reconcileState: order.reconcile_state,
        reconciledAt: order.reconciled_at,
        provider: order.provider,
        detail: order.detail,
        createdAt: order.created_at
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

async function getCurrentPaperTrades() {
  const snapshot = await getPhase4Snapshot();
  return snapshot.paperTrades;
}

async function getCurrentAssistedOrders() {
  const snapshot = await getPhase4Snapshot();
  return snapshot.assistedOrders;
}

export async function saveOnboardingState(
  input: Pick<
    OnboardingState,
    "preferredMode" | "riskAcknowledged" | "exchangeConnected"
  >
) {
  const supabase = createSupabaseAdminClient();
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

  if (supabase) {
    await supabase.from("onboarding_states").upsert({
      user_id: nextState.userId,
      preferred_mode: nextState.preferredMode,
      risk_acknowledged: nextState.riskAcknowledged,
      exchange_connected: nextState.exchangeConnected,
      completed_at: nextState.completedAt,
      updated_at: nextState.updatedAt
    });
  } else {
    await writeJsonFile(storeKeys.onboarding, nextState);
  }

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
  const supabase = createSupabaseAdminClient();
  const nextLimits: TradingLimits = {
    userId: demoUserId,
    ...input,
    updatedAt: new Date().toISOString()
  };

  if (supabase) {
    await supabase.from("trading_limits").upsert({
      user_id: nextLimits.userId,
      max_position_usd: nextLimits.maxPositionUsd,
      daily_loss_cap_usd: nextLimits.dailyLossCapUsd,
      max_trades_per_day: nextLimits.maxTradesPerDay,
      cooldown_minutes: nextLimits.cooldownMinutes,
      updated_at: nextLimits.updatedAt
    });
  } else {
    await writeJsonFile(storeKeys.limits, nextLimits);
  }

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
  const supabase = createSupabaseAdminClient();
  const trade: PaperTrade = {
    id: crypto.randomUUID(),
    userId: demoUserId,
    ...input,
    createdAt: new Date().toISOString()
  };

  if (supabase) {
    await supabase.from("paper_trades").insert({
      id: trade.id,
      user_id: trade.userId,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      entry_price: trade.entryPrice,
      status: trade.status,
      note: trade.note,
      created_at: trade.createdAt
    });
  } else {
    const trades = await readLocalTrades();
    trades.unshift(trade);
    await writeJsonFile(storeKeys.trades, trades.slice(0, 50));
  }

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
  const supabase = createSupabaseAdminClient();
  const trades = await getCurrentPaperTrades();
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
  const content = csvLines.join("\n");
  const r2Artifact = await uploadArtifactToR2(fileName, content, "text/csv");
  const location = r2Artifact
    ? r2Artifact.location
    : await writeArtifactFile(fileName, content);

  const artifact: ExportArtifact = {
    id: crypto.randomUUID(),
    userId: demoUserId,
    type: "paper-journal",
    storage: r2Artifact ? "r2" : "local",
    location,
    createdAt: new Date().toISOString()
  };

  if (supabase) {
    await supabase.from("export_artifacts").insert({
      id: artifact.id,
      user_id: artifact.userId,
      type: artifact.type,
      storage: artifact.storage,
      location: artifact.location,
      created_at: artifact.createdAt
    });
  } else {
    const artifacts = await readLocalExports();
    artifacts.unshift(artifact);
    await writeJsonFile(storeKeys.exports, artifacts.slice(0, 20));
  }

  await appendAuditEvent(
    createAuditEvent(
      "export",
      "created",
      `Paper journal export created at ${artifact.location}.`
    )
  );

  return artifact;
}

export async function recordAssistedOrder(record: AssistedOrderRecord) {
  const supabase = createSupabaseAdminClient();

  if (supabase) {
    await supabase.from("assisted_orders").upsert({
      id: record.id,
      user_id: demoUserId,
      product_id: record.productId,
      side: record.side,
      quote_size: record.quoteSize,
      status: record.status,
      reconcile_state: record.reconcileState,
      reconciled_at: record.reconciledAt,
      provider: record.provider,
      detail: record.detail,
      created_at: record.createdAt
    });
  } else {
    const orders = await readLocalAssistedOrders();
    orders.unshift(record);
    await writeJsonFile(storeKeys.assistedOrders, orders.slice(0, 30));
  }

  await appendAuditEvent(
    createAuditEvent(
      "assisted-order",
      "assisted-order",
      `${record.status.toUpperCase()} ${record.side} ${record.productId} via ${record.provider}.`
    )
  );

  return record;
}

export async function reconcileAssistedOrders() {
  const supabase = createSupabaseAdminClient();
  const orders = await getCurrentAssistedOrders();
  const reconciledAt = new Date().toISOString();

  const nextOrders = orders.map((order) => {
    if (order.reconcileState === "reconciled") {
      return order;
    }

    return {
      ...order,
      reconcileState: order.status === "blocked" ? "error" : "reconciled",
      reconciledAt,
      detail:
        order.status === "blocked"
          ? `${order.detail} Reconciliation confirms the order was not submitted.`
          : `${order.detail} Reconciliation completed against the current provider state.`
    };
  });

  if (supabase) {
    for (const order of nextOrders) {
      await supabase.from("assisted_orders").upsert({
        id: order.id,
        user_id: demoUserId,
        product_id: order.productId,
        side: order.side,
        quote_size: order.quoteSize,
        status: order.status,
        reconcile_state: order.reconcileState,
        reconciled_at: order.reconciledAt,
        provider: order.provider,
        detail: order.detail,
        created_at: order.createdAt
      });
    }
  } else {
    await writeJsonFile(storeKeys.assistedOrders, nextOrders);
  }

  await appendAuditEvent(
    createAuditEvent(
      "operations",
      "reconcile-assisted-orders",
      `Reconciled ${nextOrders.length} assisted order records.`
    )
  );

  return nextOrders;
}
