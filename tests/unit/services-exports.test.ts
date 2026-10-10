import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportArtifact } from "@/lib/types";

const m = vi.hoisted(() => ({
  getExport: vi.fn(),
  insertExport: vi.fn(),
  appendAudit: vi.fn(),
  listAudit: vi.fn(),
  listPaperTrades: vi.fn(),
  listAssistedOrders: vi.fn(),
  getArtifactFromR2: vi.fn(),
  uploadArtifactToR2: vi.fn(),
  readArtifactFile: vi.fn(),
  writeArtifactFile: vi.fn()
}));

vi.mock("@/lib/server/repos/exports", () => ({ getExport: m.getExport, insertExport: m.insertExport }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit, listAudit: m.listAudit }));
vi.mock("@/lib/server/repos/paper", () => ({ listPaperTrades: m.listPaperTrades }));
vi.mock("@/lib/server/repos/assisted", () => ({ listAssistedOrders: m.listAssistedOrders }));
vi.mock("@/lib/server/artifacts", () => ({ readArtifactFile: m.readArtifactFile, writeArtifactFile: m.writeArtifactFile }));
vi.mock("@/lib/server/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/r2")>();
  return { ...actual, getArtifactFromR2: m.getArtifactFromR2, uploadArtifactToR2: m.uploadArtifactToR2 };
});

import { R2NotFoundError, R2UnavailableError, parseR2Location } from "@/lib/server/r2";
import { createExport, downloadFileName, EXPORT_ROW_LIMIT, openExportDownload } from "@/lib/server/services/exports";

const USER = "user-1";
const ID = "3f2b9c1e-8a4d-4f6b-9c2d-1e5a7b8c9d0e";

function artifact(o: Partial<ExportArtifact>): ExportArtifact {
  return { id: ID, userId: USER, type: "paper-journal", storage: "local", location: "/srv/.local-data/exports/paper-journal-user-1-x.csv", createdAt: "2026-10-10T10:00:00.000Z", ...o };
}

const stream = () => new Response("a,b\n1,2").body!;

beforeEach(() => {
  vi.resetAllMocks();
  m.appendAudit.mockResolvedValue(undefined);
});

describe("openExportDownload", () => {
  it("answers 404 for a malformed id without querying, and for an export that is missing or someone else's", async () => {
    expect(await openExportDownload(USER, "../../etc/passwd")).toEqual({ ok: false, status: 404, message: "Export not found." });
    expect(m.getExport).not.toHaveBeenCalled();
    m.getExport.mockResolvedValue(null);
    expect(await openExportDownload(USER, ID)).toMatchObject({ ok: false, status: 404 });
    expect(m.getExport).toHaveBeenCalledWith(ID, USER);
  });

  it("streams a local export by its file name and audits the download", async () => {
    m.getExport.mockResolvedValue(artifact({}));
    m.readArtifactFile.mockResolvedValue(stream());
    const result = await openExportDownload(USER, ID);
    expect(result).toMatchObject({ ok: true, fileName: "paper-journal-user-1-x.csv" });
    expect(m.readArtifactFile).toHaveBeenCalledWith("/srv/.local-data/exports/paper-journal-user-1-x.csv");
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "export", "downloaded", "Paper journal export downloaded: paper-journal-user-1-x.csv");
  });

  it("streams an R2 export, old r2:// rows included", async () => {
    m.getExport.mockResolvedValue(artifact({ storage: "r2", location: "r2://kairis-prod/audit-log-user-1-y.csv", type: "audit-log" }));
    m.getArtifactFromR2.mockResolvedValue(stream());
    const result = await openExportDownload(USER, ID);
    expect(result).toMatchObject({ ok: true, fileName: "audit-log-user-1-y.csv" });
    expect(m.getArtifactFromR2).toHaveBeenCalledWith("r2://kairis-prod/audit-log-user-1-y.csv");
  });

  it("says plainly when the file is gone or storage is not configured", async () => {
    m.getExport.mockResolvedValue(artifact({ storage: "r2", location: "k.csv" }));
    m.getArtifactFromR2.mockRejectedValueOnce(new R2NotFoundError("This export file is no longer available."));
    expect(await openExportDownload(USER, ID)).toEqual({ ok: false, status: 404, message: "This export file is no longer available." });
    m.getArtifactFromR2.mockRejectedValueOnce(new R2UnavailableError("Export storage (R2) is not configured on this server."));
    expect(await openExportDownload(USER, ID)).toMatchObject({ ok: false, status: 503 });
    m.getExport.mockResolvedValue(artifact({}));
    m.readArtifactFile.mockResolvedValue(null);
    expect(await openExportDownload(USER, ID)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("createExport", () => {
  it("exports up to the full history window and records an export audit event", async () => {
    m.listPaperTrades.mockResolvedValue([]);
    m.writeArtifactFile.mockImplementation(async (name: string) => `/srv/exports/${name}`);
    m.insertExport.mockImplementation(async (a: ExportArtifact) => ({ ...a, id: ID, createdAt: "2026-10-10T10:00:00.000Z" }));

    const created = await createExport(USER, "paper-journal");

    expect(created.id).toBe(ID);
    expect(m.listPaperTrades).toHaveBeenCalledWith(USER, EXPORT_ROW_LIMIT);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "export", "created", expect.stringContaining("Paper journal export with 0 rows saved to server disk"));
  });

  it("records a failed export before rethrowing", async () => {
    m.listPaperTrades.mockRejectedValue(new Error("db down"));
    await expect(createExport(USER, "paper-journal")).rejects.toThrow("db down");
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "export", "failed", "Paper journal export failed: db down");
  });
});

describe("parseR2Location", () => {
  it("reads bare keys, old r2:// locations and old public URLs", () => {
    expect(parseR2Location("paper-journal-x.csv", "kairis-prod")).toEqual({ bucket: "kairis-prod", key: "paper-journal-x.csv" });
    expect(parseR2Location("r2://old-bucket/paper-journal-x.csv", "kairis-prod")).toEqual({ bucket: "old-bucket", key: "paper-journal-x.csv" });
    expect(parseR2Location("https://files.example.com/exports/a%20b.csv", "kairis-prod", "https://files.example.com/exports/")).toEqual({ bucket: "kairis-prod", key: "a b.csv" });
    expect(parseR2Location("https://pub.r2.dev/a.csv", "kairis-prod")).toEqual({ bucket: "kairis-prod", key: "a.csv" });
  });
});

describe("downloadFileName", () => {
  it("uses the stored file name, reduced to safe characters", () => {
    expect(downloadFileName({ type: "audit-log", location: "C:\\data\\exports\\audit-log-u-1.csv", createdAt: "2026-10-10T00:00:00Z" })).toBe("audit-log-u-1.csv");
    expect(downloadFileName({ type: "audit-log", location: 'we"ird name.csv', createdAt: "2026-10-10T00:00:00Z" })).toBe("we-ird-name.csv");
    expect(downloadFileName({ type: "audit-log", location: "r2://b/", createdAt: "2026-10-10T00:00:00Z" })).toBe("audit-log-2026-10-10.csv");
  });
});
