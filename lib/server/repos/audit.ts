import { query } from "@/lib/server/db";
import { toIso, type Timestamp } from "@/lib/server/repos/map";
import type { AuditCategory, AuditEvent } from "@/lib/types";

type AuditEventRow = {
  id: string;
  user_id: string;
  category: AuditCategory;
  action: string;
  detail: string;
  created_at: Timestamp;
};

const COLUMNS = "id, user_id, category, action, detail, created_at";

function mapAudit(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    action: row.action,
    detail: row.detail,
    createdAt: toIso(row.created_at)
  };
}

export async function appendAudit(userId: string, category: AuditCategory, action: string, detail: string): Promise<AuditEvent> {
  const rows = await query<AuditEventRow>(
    `insert into audit_events (user_id, category, action, detail) values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [userId, category, action, detail]
  );
  return mapAudit(rows[0]);
}

export async function listAudit(userId: string, opts?: { category?: AuditCategory; limit?: number }): Promise<AuditEvent[]> {
  const limit = opts?.limit ?? 200;
  const rows = opts?.category
    ? await query<AuditEventRow>(
        `select ${COLUMNS} from audit_events where user_id = $1 and category = $2 order by created_at desc limit $3`,
        [userId, opts.category, limit]
      )
    : await query<AuditEventRow>(`select ${COLUMNS} from audit_events where user_id = $1 order by created_at desc limit $2`, [userId, limit]);
  return rows.map(mapAudit);
}
