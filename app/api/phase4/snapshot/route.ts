import { NextResponse } from "next/server";
import { getPhase4Snapshot } from "@/lib/server/phase4-store";

export async function GET() {
  const snapshot = await getPhase4Snapshot();
  return NextResponse.json(snapshot);
}
