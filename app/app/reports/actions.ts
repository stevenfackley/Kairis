"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { oneOf } from "@/lib/search-params";
import { createExport } from "@/lib/server/services/exports";
import { requireOnboarded } from "@/lib/server/session";
import type { ExportType } from "@/lib/types";

const TYPES = ["paper-journal", "assisted-orders", "audit-log"] as const satisfies readonly ExportType[];

export async function createExportAction(formData: FormData): Promise<void> {
  const user = await requireOnboarded("/app/reports");
  const raw = formData.get("type");
  const type = oneOf(typeof raw === "string" ? raw : null, TYPES);
  let target: string;
  if (!type) {
    target = `/app/reports?error=${encodeURIComponent("Unknown export type.")}`;
  } else {
    try {
      const artifact = await createExport(user.id, type);
      target = `/app/reports?created=${encodeURIComponent(artifact.id)}`;
    } catch (e) {
      console.error("export failed", e);
      target = `/app/reports?error=${encodeURIComponent(`The export could not be created: ${e instanceof Error ? e.message : "unknown error."}`)}`;
    }
  }
  revalidatePath("/app/reports");
  redirect(target);
}
