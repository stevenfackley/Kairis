import { query } from "@/lib/server/db";
import { emptyToNull, toIso, type Timestamp } from "@/lib/server/repos/map";
import type { ExchangeConnection } from "@/lib/types";

export type SealedSecret = { ciphertext: string; iv: string; tag: string };
export type StoredExchangeConnection = ExchangeConnection & { sealed: SealedSecret };

type ExchangeConnectionRow = {
  user_id: string;
  provider: "coinbase";
  key_id: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  can_view: boolean;
  can_trade: boolean;
  can_transfer: boolean;
  portfolio_uuid: string | null;
  portfolio_type: string | null;
  validated_at: Timestamp;
  created_at: Timestamp;
};

const COLUMNS =
  "user_id, provider, key_id, secret_ciphertext, secret_iv, secret_tag, can_view, can_trade, can_transfer, portfolio_uuid, portfolio_type, validated_at, created_at";

function mapConnection(row: ExchangeConnectionRow): ExchangeConnection {
  return {
    userId: row.user_id,
    provider: row.provider,
    keyId: row.key_id,
    canView: row.can_view,
    canTrade: row.can_trade,
    canTransfer: row.can_transfer,
    portfolioUuid: row.portfolio_uuid,
    portfolioType: row.portfolio_type,
    validatedAt: toIso(row.validated_at),
    createdAt: toIso(row.created_at)
  };
}

export async function getConnection(userId: string): Promise<StoredExchangeConnection | null> {
  const rows = await query<ExchangeConnectionRow>(`select ${COLUMNS} from exchange_connections where user_id = $1`, [userId]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { ...mapConnection(row), sealed: { ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag } };
}

// Upsert; the sealed secret goes in but never comes back out of this call.
export async function saveConnection(input: StoredExchangeConnection): Promise<ExchangeConnection> {
  const rows = await query<ExchangeConnectionRow>(
    `insert into exchange_connections
       (user_id, provider, key_id, secret_ciphertext, secret_iv, secret_tag, can_view, can_trade, can_transfer, portfolio_uuid, portfolio_type, validated_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13::timestamptz, now()))
     on conflict (user_id) do update set
       provider = excluded.provider,
       key_id = excluded.key_id,
       secret_ciphertext = excluded.secret_ciphertext,
       secret_iv = excluded.secret_iv,
       secret_tag = excluded.secret_tag,
       can_view = excluded.can_view,
       can_trade = excluded.can_trade,
       can_transfer = excluded.can_transfer,
       portfolio_uuid = excluded.portfolio_uuid,
       portfolio_type = excluded.portfolio_type,
       validated_at = excluded.validated_at
     returning ${COLUMNS}`,
    [
      input.userId,
      input.provider,
      input.keyId,
      input.sealed.ciphertext,
      input.sealed.iv,
      input.sealed.tag,
      input.canView,
      input.canTrade,
      input.canTransfer,
      input.portfolioUuid,
      input.portfolioType ?? null,
      input.validatedAt,
      emptyToNull(input.createdAt)
    ]
  );
  return mapConnection(rows[0]);
}

export async function deleteConnection(userId: string): Promise<void> {
  await query("delete from exchange_connections where user_id = $1", [userId]);
}
