import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/server/system-status";

export async function GET() {
  return NextResponse.json(await getSystemStatus());
}
