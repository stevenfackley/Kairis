import { toCsv, type CsvCell } from "@/lib/domain/csv";
import { isUuid } from "@/lib/domain/order-form";
import { env } from "@/lib/env";
import { readArtifactFile, writeArtifactFile } from "@/lib/server/artifacts";
import { getArtifactFromR2, R2NotFoundError, R2UnavailableError, uploadArtifactToR2 } from "@/lib/server/r2";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { appendAudit, listAudit } from "@/lib/server/repos/audit";
import { getExport, insertExport } from "@/lib/server/repos/exports";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { errorMessage } from "@/lib/server/services/shared";
import type { AssistedOrder, AuditEvent, ExportArtifact, ExportType, PaperTrade } from "@/lib/types";

/** Newest rows first; an export holds at most this many (the same window positions are rebuilt from). */
export const EXPORT_ROW_LIMIT = 100_000;

const PAPER_COLUMNS = [
  "id",
  "createdAt",
  "productId",
  "side",
  "baseSize",
  "price",
  "quoteUsd",
  "feeUsd",
  "status",
  "realizedPnlUsd",
  "signalId",
  "note"
] as const satisfies ReadonlyArray<keyof PaperTrade>;
const ASSISTED_COLUMNS = [
  "id",
  "createdAt",
  "updatedAt",
  "productId",
  "side",
  "quoteUsd",
  "status",
  "reconcileState",
  "provider",
  "orderId",
  "clientOrderId",
  "exchangeStatus",
  "filledSize",
  "averagePrice",
  "totalFees",
  "detail"
] as const satisfies ReadonlyArray<keyof AssistedOrder>;
const AUDIT_COLUMNS = ["id", "createdAt", "category", "action", "detail"] as const satisfies ReadonlyArray<keyof AuditEvent>;

export const EXPORT_LABEL: Record<ExportType, string> = {
  "paper-journal": "Paper journal",
  "assisted-orders": "Assisted orders",
  "audit-log": "Audit log"
};

function toCell(value: unknown): CsvCell {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function table<T, K extends keyof T>(columns: readonly K[], rows: T[]): string {
  return toCsv(
    columns.map((c) => String(c)),
    rows.map((row) => columns.map((c) => toCell(row[c])))
  );
}

async function buildCsv(userId: string, type: ExportType): Promise<{ csv: string; rows: number }> {
  switch (type) {
    case "paper-journal": {
      const rows = await listPaperTrades(userId, EXPORT_ROW_LIMIT);
      return { csv: table(PAPER_COLUMNS, rows), rows: rows.length };
    }
    case "assisted-orders": {
      const rows = await listAssistedOrders(userId, EXPORT_ROW_LIMIT);
      return { csv: table(ASSISTED_COLUMNS, rows), rows: rows.length };
    }
    case "audit-log": {
      const rows = await listAudit(userId, { limit: EXPORT_ROW_LIMIT });
      return { csv: table(AUDIT_COLUMNS, rows), rows: rows.length };
    }
  }
}

export function exportFileName(type: ExportType, userId: string, now: Date): string {
  const safeUser = userId.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "user";
  return `${type}-${safeUser}-${now.toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}.csv`;
}

/** Writes the CSV to R2 when configured (the location is the object key), otherwise to local disk. */
export async function createExport(userId: string, type: ExportType): Promise<ExportArtifact> {
  try {
    const { csv, rows } = await buildCsv(userId, type);
    const fileName = exportFileName(type, userId, new Date());
    const uploaded = env.r2Configured ? await uploadArtifactToR2(fileName, csv, "text/csv") : null;
    const target = uploaded ?? { storage: "local" as const, location: await writeArtifactFile(fileName, csv) };
    const artifact = await insertExport({ id: "", userId, type, storage: target.storage, location: target.location, createdAt: "" });
    await appendAudit(userId, "export", "created", `${EXPORT_LABEL[type]} export with ${rows.toLocaleString("en-US")} rows saved to ${target.storage === "r2" ? "R2" : "server disk"}: ${fileName}`);
    return artifact;
  } catch (error) {
    await appendAudit(userId, "export", "failed", `${EXPORT_LABEL[type]} export failed: ${errorMessage(error)}`).catch(() => undefined);
    throw error;
  }
}

/** The file name offered to the browser: the stored file's own name, reduced to safe characters. */
export function downloadFileName(artifact: Pick<ExportArtifact, "type" | "location" | "createdAt">): string {
  const last = artifact.location.replaceAll("\\", "/").split("/").pop() ?? "";
  const safe = last.replace(/[^A-Za-z0-9._-]/g, "-");
  return safe.endsWith(".csv") && safe.length > 4 ? safe : `${artifact.type}-${artifact.createdAt.slice(0, 10)}.csv`;
}

export type ExportDownload =
  | { ok: true; fileName: string; body: ReadableStream<Uint8Array> }
  | { ok: false; status: 404 | 503; message: string };

const NOT_FOUND: ExportDownload = { ok: false, status: 404, message: "Export not found." };

/**
 * Opens one of the user's own exports for download, wherever it is stored. Another user's export
 * answers exactly like a missing one.
 */
export async function openExportDownload(userId: string, id: string): Promise<ExportDownload> {
  if (!isUuid(id)) return NOT_FOUND;
  const artifact = await getExport(id, userId);
  if (!artifact) return NOT_FOUND;
  let body: ReadableStream<Uint8Array> | null;
  try {
    body = artifact.storage === "r2" ? await getArtifactFromR2(artifact.location) : await readArtifactFile(artifact.location);
  } catch (error) {
    if (error instanceof R2NotFoundError) return { ok: false, status: 404, message: error.message };
    if (error instanceof R2UnavailableError) return { ok: false, status: 503, message: error.message };
    throw error;
  }
  if (!body) return { ok: false, status: 404, message: "This export file is no longer available on the server." };
  const fileName = downloadFileName(artifact);
  await appendAudit(userId, "export", "downloaded", `${EXPORT_LABEL[artifact.type]} export downloaded: ${fileName}`);
  return { ok: true, fileName, body };
}
