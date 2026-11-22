import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  reconcileAssisted: vi.fn(),
  runAutoCycle: vi.fn(),
  appendAudit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/server/session", () => ({ requireOwner: m.requireOwner }));
vi.mock("@/lib/server/services/assisted", () => ({ reconcileAssisted: m.reconcileAssisted }));
vi.mock("@/lib/server/services/auto", () => ({ runAutoCycle: m.runAutoCycle }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));

import { reconcileAllAction } from "@/app/app/operations/actions";

const OWNER = { id: "owner-1", email: null, name: null, roles: [], isOwner: true };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireOwner.mockResolvedValue(OWNER);
  m.appendAudit.mockResolvedValue(undefined);
});

describe("reconcileAllAction", () => {
  it("leaves the audit row to reconcileAssisted, so one reconcile writes one row", async () => {
    m.reconcileAssisted.mockResolvedValue({ checked: 3, updated: 1 });

    await reconcileAllAction();

    expect(m.reconcileAssisted).toHaveBeenCalledWith("owner-1");
    expect(m.appendAudit).not.toHaveBeenCalled();
    expect(m.redirect).toHaveBeenCalledWith("/app/operations?reconciled=3,1");
  });
});
