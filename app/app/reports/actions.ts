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
  let error: string | null = null;
  if (!type) {
    error = "Unknown export type.";
  } else {
    try {
      await createExport(user.id, type);
    } catch (e) {
      error = e instanceof Error ? e.message : "Export failed.";
    }
  }
  revalidatePath("/app/reports");
  if (error) redirect(`/app/reports?error=${encodeURIComponent(error)}`);
  redirect("/app/reports");
}
