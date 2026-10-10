import { query } from "@/lib/server/db";
import { toIso, toJsonParam, toNumber, toNumberOrNull, toStringArray, type Numeric, type Timestamp } from "@/lib/server/repos/map";
import type { SignalAction, SignalEvaluation, SignalRecord } from "@/lib/types";

type SignalRow = {
  id: string;
  product_id: string;
  action: SignalAction;
  setup: string;
  rationale: unknown;
  strength: Numeric;
  reference_price: Numeric;
  atr_pct: Numeric | null;
  rsi: Numeric | null;
  spread_pct: Numeric | null;
  data_age_ms: number;
  evaluated_at: Timestamp;
};

const COLUMNS = "id, product_id, action, setup, rationale, strength, reference_price, atr_pct, rsi, spread_pct, data_age_ms, evaluated_at";

// data_age_ms is a Postgres integer; a missing ticker time can yield an age far past int4.
const MAX_INT4 = 2147483647;

function mapSignal(row: SignalRow): SignalRecord {
  return {
    id: row.id,
    productId: row.product_id,
    action: row.action,
    setup: row.setup,
    rationale: toStringArray(row.rationale),
    strength: toNumber(row.strength),
    referencePrice: toNumber(row.reference_price),
    atrPct: toNumberOrNull(row.atr_pct),
    rsi: toNumberOrNull(row.rsi),
    spreadPct: toNumberOrNull(row.spread_pct),
    dataAgeMs: row.data_age_ms,
    evaluatedAt: toIso(row.evaluated_at)
  };
}

export async function insertSignal(evaluation: SignalEvaluation): Promise<SignalRecord> {
  const rows = await query<SignalRow>(
    `insert into signals (product_id, action, setup, rationale, strength, reference_price, atr_pct, rsi, spread_pct, data_age_ms, evaluated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
     returning ${COLUMNS}`,
    [
      evaluation.productId,
      evaluation.action,
      evaluation.setup,
      toJsonParam(evaluation.rationale),
      evaluation.strength,
      evaluation.referencePrice,
      evaluation.atrPct,
      evaluation.rsi,
      evaluation.spreadPct,
      Math.min(MAX_INT4, Math.max(0, Math.round(evaluation.dataAgeMs))),
      evaluation.evaluatedAt
    ]
  );
  return mapSignal(rows[0]);
}

export async function latestSignals(): Promise<SignalRecord[]> {
  const rows = await query<SignalRow>(
    `select ${COLUMNS} from (
       select distinct on (product_id) ${COLUMNS}
       from signals
       order by product_id, evaluated_at desc
     ) latest
     order by product_id`
  );
  return rows.map(mapSignal);
}

export async function getSignal(id: string): Promise<SignalRecord | null> {
  const rows = await query<SignalRow>(`select ${COLUMNS} from signals where id = $1`, [id]);
  return rows[0] ? mapSignal(rows[0]) : null;
}
