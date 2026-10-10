import { toCsv, type CsvCell } from "@/lib/domain/csv";
import { env } from "@/lib/env";
import { writeArtifactFile } from "@/lib/server/artifacts";
import { uploadArtifactToR2 } from "@/lib/server/r2";
import { listAssistedOrders } from "@/lib/server/repos/assisted";
import { appendAudit, listAudit } from "@/lib/server/repos/audit";
import { insertExport } from "@/lib/server/repos/exports";
import { listPaperTrades } from "@/lib/server/repos/paper";
import type { AssistedOrder, AuditEvent, ExportArtifact, ExportType, PaperTrade } from "@/lib/types";

const EXPORT_LIMIT = 1000;

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

function toCell(value: unknown): CsvCell {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function table<T, K extends keyof T>(columns: readonly K[], rows: T[]): string {
  return toCsv(
    columns.map((c) => String(c)),
    rows.map((row) => columns.map((c) => toCell(row[c])))
  );
}

async function buildCsv(userId: string, type: ExportType): Promise<string> {
  switch (type) {
    case "paper-journal":
      return table(PAPER_COLUMNS, await listPaperTrades(userId, EXPORT_LIMIT));
    case "assisted-orders":
      return table(ASSISTED_COLUMNS, await listAssistedOrders(userId, EXPORT_LIMIT));
    case "audit-log":
      return table(AUDIT_COLUMNS, await listAudit(userId, { limit: EXPORT_LIMIT }));
  }
}

export function exportFileName(type: ExportType, userId: string, now: Date): string {
  const safeUser = userId.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "user";
  return `${type}-${safeUser}-${now.toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}.csv`;
}

export async function createExport(userId: string, type: ExportType): Promise<ExportArtifact> {
  const content = await buildCsv(userId, type);
  const fileName = exportFileName(type, userId, new Date());
  const uploaded = env.r2Configured ? await uploadArtifactToR2(fileName, content, "text/csv") : null;
  const target = uploaded ?? { storage: "local" as const, location: await writeArtifactFile(fileName, content) };
  const artifact = await insertExport({ id: "", userId, type, storage: target.storage, location: target.location, createdAt: "" });
  await appendAudit(userId, "export", "created", `${type} export written to ${target.storage}: ${fileName}`);
  return artifact;
}
