import { DEFAULT_LIMITS } from "@/lib/domain/strategy";
import { query } from "@/lib/server/db";
import { toIso, toNumber, toNumberRecord, type Numeric, type Timestamp } from "@/lib/server/repos/map";
import type { TradingLimits } from "@/lib/types";

type LimitsRow = {
  user_id: string;
  max_position_usd: Numeric;
  daily_loss_cap_usd: Numeric;
  max_trades_per_day: number;
  cooldown_minutes: number;
  loss_streak_trigger: number;
  per_symbol_max_usd: unknown;
  trading_paused: boolean;
  updated_at: Timestamp;
};

const COLUMNS =
  "user_id, max_position_usd, daily_loss_cap_usd, max_trades_per_day, cooldown_minutes, loss_streak_trigger, per_symbol_max_usd, trading_paused, updated_at";

function mapLimits(row: LimitsRow): TradingLimits {
  return {
    userId: row.user_id,
    maxPositionUsd: toNumber(row.max_position_usd),
    dailyLossCapUsd: toNumber(row.daily_loss_cap_usd),
    maxTradesPerDay: row.max_trades_per_day,
    cooldownMinutes: row.cooldown_minutes,
    lossStreakTrigger: row.loss_streak_trigger,
    perSymbolMaxUsd: toNumberRecord(row.per_symbol_max_usd),
    tradingPaused: row.trading_paused,
    updatedAt: toIso(row.updated_at)
  };
}

export async function getLimits(userId: string): Promise<TradingLimits> {
  const rows = await query<LimitsRow>(`select ${COLUMNS} from trading_limits where user_id = $1`, [userId]);
  if (rows[0]) {
    return mapLimits(rows[0]);
  }
  return {
    userId,
    ...DEFAULT_LIMITS,
    perSymbolMaxUsd: {},
    tradingPaused: false,
    updatedAt: new Date().toISOString()
  };
}

export async function saveLimits(limits: Omit<TradingLimits, "updatedAt">): Promise<TradingLimits> {
  const rows = await query<LimitsRow>(
    `insert into trading_limits
       (user_id, max_position_usd, daily_loss_cap_usd, max_trades_per_day, cooldown_minutes, loss_streak_trigger, per_symbol_max_usd, trading_paused, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
     on conflict (user_id) do update set
       max_position_usd = excluded.max_position_usd,
       daily_loss_cap_usd = excluded.daily_loss_cap_usd,
       max_trades_per_day = excluded.max_trades_per_day,
       cooldown_minutes = excluded.cooldown_minutes,
       loss_streak_trigger = excluded.loss_streak_trigger,
       per_symbol_max_usd = excluded.per_symbol_max_usd,
       trading_paused = excluded.trading_paused,
       updated_at = now()
     returning ${COLUMNS}`,
    [
      limits.userId,
      limits.maxPositionUsd,
      limits.dailyLossCapUsd,
      limits.maxTradesPerDay,
      limits.cooldownMinutes,
      limits.lossStreakTrigger,
      JSON.stringify(limits.perSymbolMaxUsd),
      limits.tradingPaused
    ]
  );
  return mapLimits(rows[0]);
}

// Creates the default row when absent so pausing works before the user ever saved limits.
export async function setTradingPaused(userId: string, paused: boolean): Promise<TradingLimits> {
  const rows = await query<LimitsRow>(
    `insert into trading_limits
       (user_id, max_position_usd, daily_loss_cap_usd, max_trades_per_day, cooldown_minutes, loss_streak_trigger, per_symbol_max_usd, trading_paused, updated_at)
     values ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, now())
     on conflict (user_id) do update set
       trading_paused = excluded.trading_paused,
       updated_at = now()
     returning ${COLUMNS}`,
    [
      userId,
      DEFAULT_LIMITS.maxPositionUsd,
      DEFAULT_LIMITS.dailyLossCapUsd,
      DEFAULT_LIMITS.maxTradesPerDay,
      DEFAULT_LIMITS.cooldownMinutes,
      DEFAULT_LIMITS.lossStreakTrigger,
      paused
    ]
  );
  return mapLimits(rows[0]);
}
