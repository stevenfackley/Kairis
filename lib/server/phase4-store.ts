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
import { getDatabasePool } from "@/lib/server/database";

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
  const database = getDatabasePool();

  if (database) {
    await database.query(
      `insert into public.audit_events (id, user_id, category, action, detail, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [event.id, event.userId, event.category, event.action, event.detail, event.createdAt]
    );

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

async function getDatabaseSnapshot(): Promise<Phase4Snapshot | null> {
  const database = getDatabasePool();
  if (!database) {
    return null;
  }

  try {
    const [
      onboardingResult,
      limitsResult,
      tradesResult,
      auditsResult,
      exportsResult,
      assistedOrdersResult
    ] = await Promise.all([
      database.query("select * from public.onboarding_states where user_id = $1 limit 1", [demoUserId]),
      database.query("select * from public.trading_limits where user_id = $1 limit 1", [demoUserId]),
      database.query(
        "select * from public.paper_trades where user_id = $1 order by created_at desc",
        [demoUserId]
      ),
      database.query(
        "select * from public.audit_events where user_id = $1 order by created_at desc limit 50",
        [demoUserId]
      ),
      database.query(
        "select * from public.export_artifacts where user_id = $1 order by created_at desc",
        [demoUserId]
      ),
      database.query(
        "select * from public.assisted_orders where user_id = $1 order by created_at desc",
        [demoUserId]
      )
    ]);

    const onboardingRow = onboardingResult.rows[0];
    const limitsRow = limitsResult.rows[0];

    return {
      onboarding: onboardingRow
        ? {
            userId: onboardingRow.user_id,
            preferredMode: onboardingRow.preferred_mode,
            riskAcknowledged: onboardingRow.risk_acknowledged,
            exchangeConnected: onboardingRow.exchange_connected,
            completedAt: onboardingRow.completed_at,
            updatedAt: onboardingRow.updated_at
          }
        : getDefaultOnboardingState(),
      limits: limitsRow
        ? {
            userId: limitsRow.user_id,
            maxPositionUsd: Number(limitsRow.max_position_usd),
            dailyLossCapUsd: Number(limitsRow.daily_loss_cap_usd),
            maxTradesPerDay: limitsRow.max_trades_per_day,
            cooldownMinutes: limitsRow.cooldown_minutes,
            updatedAt: limitsRow.updated_at
          }
        : getDefaultTradingLimits(),
      paperTrades: tradesResult.rows.map((trade) => ({
        id: trade.id,
        userId: trade.user_id,
        symbol: trade.symbol,
        side: trade.side,
        quantity: Number(trade.quantity),
        entryPrice: Number(trade.entry_price),
        status: trade.status,
        note: trade.note,
        createdAt: trade.created_at
      })),
      auditEvents: auditsResult.rows.map((event) => ({
        id: event.id,
        userId: event.user_id,
        category: event.category,
        action: event.action,
        detail: event.detail,
        createdAt: event.created_at
      })),
      exports: exportsResult.rows.map((artifact) => ({
        id: artifact.id,
        userId: artifact.user_id,
        type: artifact.type,
        storage: artifact.storage,
        location: artifact.location,
        createdAt: artifact.created_at
      })),
      assistedOrders: assistedOrdersResult.rows.map((order) => ({
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
      })),
      storage: {
        provider: "postgres",
        artifacts: env.r2Configured ? "r2" : "local"
      }
    };
  } catch {
    return null;
  }
}

export async function getPhase4Snapshot(): Promise<Phase4Snapshot> {
  const snapshot = await getDatabaseSnapshot();
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
  const database = getDatabasePool();
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

  if (database) {
    await database.query(
      `insert into public.onboarding_states (
         user_id, preferred_mode, risk_acknowledged, exchange_connected, completed_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update set
         preferred_mode = excluded.preferred_mode,
         risk_acknowledged = excluded.risk_acknowledged,
         exchange_connected = excluded.exchange_connected,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
      [
        nextState.userId,
        nextState.preferredMode,
        nextState.riskAcknowledged,
        nextState.exchangeConnected,
        nextState.completedAt,
        nextState.updatedAt
      ]
    );
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
  const database = getDatabasePool();
  const nextLimits: TradingLimits = {
    userId: demoUserId,
    ...input,
    updatedAt: new Date().toISOString()
  };

  if (database) {
    await database.query(
      `insert into public.trading_limits (
         user_id, max_position_usd, daily_loss_cap_usd, max_trades_per_day, cooldown_minutes, updated_at
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update set
         max_position_usd = excluded.max_position_usd,
         daily_loss_cap_usd = excluded.daily_loss_cap_usd,
         max_trades_per_day = excluded.max_trades_per_day,
         cooldown_minutes = excluded.cooldown_minutes,
         updated_at = excluded.updated_at`,
      [
        nextLimits.userId,
        nextLimits.maxPositionUsd,
        nextLimits.dailyLossCapUsd,
        nextLimits.maxTradesPerDay,
        nextLimits.cooldownMinutes,
        nextLimits.updatedAt
      ]
    );
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
  const database = getDatabasePool();
  const trade: PaperTrade = {
    id: crypto.randomUUID(),
    userId: demoUserId,
    ...input,
    createdAt: new Date().toISOString()
  };

  if (database) {
    await database.query(
      `insert into public.paper_trades (
         id, user_id, symbol, side, quantity, entry_price, status, note, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        trade.id,
        trade.userId,
        trade.symbol,
        trade.side,
        trade.quantity,
        trade.entryPrice,
        trade.status,
        trade.note,
        trade.createdAt
      ]
    );
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
  const database = getDatabasePool();
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

  if (database) {
    await database.query(
      `insert into public.export_artifacts (
         id, user_id, type, storage, location, created_at
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        artifact.id,
        artifact.userId,
        artifact.type,
        artifact.storage,
        artifact.location,
        artifact.createdAt
      ]
    );
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
  const database = getDatabasePool();

  if (database) {
    await database.query(
      `insert into public.assisted_orders (
         id, user_id, product_id, side, quote_size, status, reconcile_state, reconciled_at, provider, detail, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         user_id = excluded.user_id,
         product_id = excluded.product_id,
         side = excluded.side,
         quote_size = excluded.quote_size,
         status = excluded.status,
         reconcile_state = excluded.reconcile_state,
         reconciled_at = excluded.reconciled_at,
         provider = excluded.provider,
         detail = excluded.detail,
         created_at = excluded.created_at`,
      [
        record.id,
        demoUserId,
        record.productId,
        record.side,
        record.quoteSize,
        record.status,
        record.reconcileState,
        record.reconciledAt,
        record.provider,
        record.detail,
        record.createdAt
      ]
    );
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
  const database = getDatabasePool();
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

  if (database) {
    for (const order of nextOrders) {
      await database.query(
        `insert into public.assisted_orders (
           id, user_id, product_id, side, quote_size, status, reconcile_state, reconciled_at, provider, detail, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set
           user_id = excluded.user_id,
           product_id = excluded.product_id,
           side = excluded.side,
           quote_size = excluded.quote_size,
           status = excluded.status,
           reconcile_state = excluded.reconcile_state,
           reconciled_at = excluded.reconciled_at,
           provider = excluded.provider,
           detail = excluded.detail,
           created_at = excluded.created_at`,
        [
          order.id,
          demoUserId,
          order.productId,
          order.side,
          order.quoteSize,
          order.status,
          order.reconcileState,
          order.reconciledAt,
          order.provider,
          order.detail,
          order.createdAt
        ]
      );
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
