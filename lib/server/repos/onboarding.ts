import { query } from "@/lib/server/db";
import { toIso, toIsoOrNull, type Timestamp } from "@/lib/server/repos/map";
import type { ExecutionMode, OnboardingState } from "@/lib/types";

type OnboardingRow = {
  user_id: string;
  preferred_mode: ExecutionMode;
  risk_acknowledged: boolean;
  exchange_connected: boolean;
  completed_at: Timestamp | null;
  updated_at: Timestamp;
};

const COLUMNS = "user_id, preferred_mode, risk_acknowledged, exchange_connected, completed_at, updated_at";

function mapOnboarding(row: OnboardingRow): OnboardingState {
  return {
    userId: row.user_id,
    preferredMode: row.preferred_mode,
    riskAcknowledged: row.risk_acknowledged,
    exchangeConnected: row.exchange_connected,
    completedAt: toIsoOrNull(row.completed_at),
    updatedAt: toIso(row.updated_at)
  };
}

export async function getOnboarding(userId: string): Promise<OnboardingState> {
  const rows = await query<OnboardingRow>(`select ${COLUMNS} from onboarding_states where user_id = $1`, [userId]);
  if (rows[0]) {
    return mapOnboarding(rows[0]);
  }
  return {
    userId,
    preferredMode: "paper",
    riskAcknowledged: false,
    exchangeConnected: false,
    completedAt: null,
    updatedAt: new Date().toISOString()
  };
}

// completed_at is server-owned: set when the risk acknowledgment is first recorded, kept on
// later saves, cleared if the acknowledgment is withdrawn. The input's completedAt is ignored.
export async function saveOnboarding(state: Omit<OnboardingState, "updatedAt">): Promise<OnboardingState> {
  const rows = await query<OnboardingRow>(
    `insert into onboarding_states (user_id, preferred_mode, risk_acknowledged, exchange_connected, completed_at, updated_at)
     values ($1, $2, $3::boolean, $4, case when $3::boolean then now() else null end, now())
     on conflict (user_id) do update set
       preferred_mode = excluded.preferred_mode,
       risk_acknowledged = excluded.risk_acknowledged,
       exchange_connected = excluded.exchange_connected,
       completed_at = case when excluded.risk_acknowledged then coalesce(onboarding_states.completed_at, now()) else null end,
       updated_at = now()
     returning ${COLUMNS}`,
    [state.userId, state.preferredMode, state.riskAcknowledged, state.exchangeConnected]
  );
  return mapOnboarding(rows[0]);
}
