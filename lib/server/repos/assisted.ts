import { query } from "@/lib/server/db";
import {
  emptyToNull,
  toIso,
  toIsoOrNull,
  toJsonParam,
  toNumber,
  toNumberOrNull,
  toRiskDecision,
  type Numeric,
  type Timestamp
} from "@/lib/server/repos/map";
import type { AssistedOrder, AssistedStatus, ReconcileState, RiskDecision, Side } from "@/lib/types";

type AssistedOrderRow = {
  id: string;
  user_id: string;
  product_id: string;
  side: Side;
  quote_size: Numeric;
  status: AssistedStatus;
  reconcile_state: ReconcileState;
  reconciled_at: Timestamp | null;
  provider: "coinbase" | "mock";
  detail: string;
  order_id: string | null;
  client_order_id: string | null;
  preview_id: string | null;
  exchange_status: string | null;
  filled_size: Numeric | null;
  average_price: Numeric | null;
  total_fees: Numeric | null;
  signal_id: string | null;
  risk_decision: unknown;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AssistedOrderPatch = Partial<
  Pick<
    AssistedOrder,
    | "status"
    | "reconcileState"
    | "reconciledAt"
    | "detail"
    | "orderId"
    | "clientOrderId"
    | "previewId"
    | "exchangeStatus"
    | "filledSize"
    | "averagePrice"
    | "totalFees"
  >
> & { riskDecision?: RiskDecision | null };

const COLUMNS =
  "id, user_id, product_id, side, quote_size, status, reconcile_state, reconciled_at, provider, detail, order_id, client_order_id, preview_id, exchange_status, filled_size, average_price, total_fees, signal_id, risk_decision, created_at, updated_at";

// Fixed key -> column map: only these identifiers ever reach the dynamic SET list.
const PATCH_COLUMNS: { [K in keyof Required<AssistedOrderPatch>]: string } = {
  status: "status",
  reconcileState: "reconcile_state",
  reconciledAt: "reconciled_at",
  detail: "detail",
  orderId: "order_id",
  clientOrderId: "client_order_id",
  previewId: "preview_id",
  exchangeStatus: "exchange_status",
  filledSize: "filled_size",
  averagePrice: "average_price",
  totalFees: "total_fees",
  riskDecision: "risk_decision"
};

function isPatchKey(key: string): key is keyof AssistedOrderPatch {
  return Object.prototype.hasOwnProperty.call(PATCH_COLUMNS, key);
}

function mapAssistedOrder(row: AssistedOrderRow): AssistedOrder {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    side: row.side,
    quoteUsd: toNumber(row.quote_size),
    status: row.status,
    reconcileState: row.reconcile_state,
    reconciledAt: toIsoOrNull(row.reconciled_at),
    provider: row.provider,
    detail: row.detail,
    orderId: row.order_id,
    clientOrderId: row.client_order_id,
    previewId: row.preview_id,
    exchangeStatus: row.exchange_status,
    filledSize: toNumberOrNull(row.filled_size),
    averagePrice: toNumberOrNull(row.average_price),
    totalFees: toNumberOrNull(row.total_fees),
    signalId: row.signal_id,
    riskDecision: toRiskDecision(row.risk_decision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export async function insertAssistedOrder(order: AssistedOrder): Promise<AssistedOrder> {
  const rows = await query<AssistedOrderRow>(
    `insert into assisted_orders
       (id, user_id, product_id, side, quote_size, status, reconcile_state, reconciled_at, provider, detail, order_id, client_order_id,
        preview_id, exchange_status, filled_size, average_price, total_fees, signal_id, risk_decision, created_at, updated_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19::jsonb, coalesce($20::timestamptz, now()), now())
     returning ${COLUMNS}`,
    [
      emptyToNull(order.id),
      order.userId,
      order.productId,
      order.side,
      order.quoteUsd,
      order.status,
      order.reconcileState,
      order.reconciledAt,
      order.provider,
      order.detail,
      order.orderId,
      order.clientOrderId,
      order.previewId,
      order.exchangeStatus,
      order.filledSize,
      order.averagePrice,
      order.totalFees,
      order.signalId,
      toJsonParam(order.riskDecision),
      emptyToNull(order.createdAt)
    ]
  );
  return mapAssistedOrder(rows[0]);
}

export async function updateAssistedOrder(id: string, patch: AssistedOrderPatch): Promise<AssistedOrder> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !isPatchKey(key)) {
      continue;
    }
    if (key === "riskDecision") {
      params.push(toJsonParam(value));
      sets.push(`risk_decision = $${params.length}::jsonb`);
      continue;
    }
    params.push(value);
    sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
  }
  sets.push("updated_at = now()");
  params.push(id);
  const rows = await query<AssistedOrderRow>(
    `update assisted_orders set ${sets.join(", ")} where id = $${params.length} returning ${COLUMNS}`,
    params
  );
  if (!rows[0]) {
    throw new Error(`Assisted order ${id} not found.`);
  }
  return mapAssistedOrder(rows[0]);
}

export async function getAssistedOrder(id: string, userId: string): Promise<AssistedOrder | null> {
  const rows = await query<AssistedOrderRow>(`select ${COLUMNS} from assisted_orders where id = $1 and user_id = $2`, [id, userId]);
  return rows[0] ? mapAssistedOrder(rows[0]) : null;
}

// Atomic single-flight guard: only one caller can flip a previewed, unclaimed order to claimed.
export async function claimPreviewedOrder(id: string, userId: string): Promise<AssistedOrder | null> {
  const rows = await query<AssistedOrderRow>(
    `update assisted_orders set submit_claimed_at = now(), updated_at = now()
     where id = $1 and user_id = $2 and status = 'previewed' and submit_claimed_at is null
     returning ${COLUMNS}`,
    [id, userId]
  );
  return rows[0] ? mapAssistedOrder(rows[0]) : null;
}

// Frees a claim taken by claimPreviewedOrder when submission failed before reaching the exchange.
export async function releaseSubmitClaim(id: string, userId: string): Promise<void> {
  await query(
    `update assisted_orders set submit_claimed_at = null, updated_at = now()
     where id = $1 and user_id = $2 and status = 'previewed'`,
    [id, userId]
  );
}

export async function listAssistedOrders(userId: string, limit = 100): Promise<AssistedOrder[]> {
  const rows = await query<AssistedOrderRow>(
    `select ${COLUMNS} from assisted_orders where user_id = $1 order by created_at desc limit $2`,
    [userId, limit]
  );
  return rows.map(mapAssistedOrder);
}

// Oldest first: the reconcile loop works the queue in submission order.
export async function listPendingAssistedOrders(userId: string): Promise<AssistedOrder[]> {
  const rows = await query<AssistedOrderRow>(
    `select ${COLUMNS} from assisted_orders
     where user_id = $1 and status = 'submitted' and reconcile_state = 'pending'
     order by created_at asc`,
    [userId]
  );
  return rows.map(mapAssistedOrder);
}
