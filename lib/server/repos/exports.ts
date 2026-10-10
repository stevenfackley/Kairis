import { query } from "@/lib/server/db";
import { emptyToNull, toIso, type Timestamp } from "@/lib/server/repos/map";
import type { ExportArtifact, ExportType } from "@/lib/types";

type ExportArtifactRow = {
  id: string;
  user_id: string;
  type: ExportType;
  storage: "r2" | "local";
  location: string;
  created_at: Timestamp;
};

const COLUMNS = "id, user_id, type, storage, location, created_at";

function mapExport(row: ExportArtifactRow): ExportArtifact {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    storage: row.storage,
    location: row.location,
    createdAt: toIso(row.created_at)
  };
}

export async function insertExport(artifact: ExportArtifact): Promise<ExportArtifact> {
  const rows = await query<ExportArtifactRow>(
    `insert into export_artifacts (id, user_id, type, storage, location, created_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, coalesce($6::timestamptz, now()))
     returning ${COLUMNS}`,
    [emptyToNull(artifact.id), artifact.userId, artifact.type, artifact.storage, artifact.location, emptyToNull(artifact.createdAt)]
  );
  return mapExport(rows[0]);
}

export async function listExports(userId: string): Promise<ExportArtifact[]> {
  const rows = await query<ExportArtifactRow>(
    `select ${COLUMNS} from export_artifacts where user_id = $1 order by created_at desc limit 200`,
    [userId]
  );
  return rows.map(mapExport);
}
