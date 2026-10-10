import { query } from "@/lib/server/db";
import { toIso, type Timestamp } from "@/lib/server/repos/map";
import type { UserRecord } from "@/lib/types";

type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_owner: boolean;
  created_at: Timestamp;
  last_seen_at: Timestamp;
};

const COLUMNS = "id, email, display_name, is_owner, created_at, last_seen_at";

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isOwner: row.is_owner,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at)
  };
}

export async function upsertUser(input: { id: string; email: string | null; displayName: string | null; isOwner: boolean }): Promise<UserRecord> {
  const rows = await query<UserRow>(
    `insert into users (id, email, display_name, is_owner)
     values ($1, $2, $3, $4)
     on conflict (id) do update set
       email = excluded.email,
       display_name = excluded.display_name,
       is_owner = excluded.is_owner,
       last_seen_at = now()
     returning ${COLUMNS}`,
    [input.id, input.email, input.displayName, input.isOwner]
  );
  return mapUser(rows[0]);
}

export async function getUser(id: string): Promise<UserRecord | null> {
  const rows = await query<UserRow>(`select ${COLUMNS} from users where id = $1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}
