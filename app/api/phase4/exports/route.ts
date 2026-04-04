import { NextResponse } from "next/server";
import { createPaperJournalExport } from "@/lib/server/phase4-store";

export async function POST() {
  const artifact = await createPaperJournalExport();
  return NextResponse.json(artifact);
}
