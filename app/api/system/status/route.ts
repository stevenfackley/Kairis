import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/server/system-status";

export function GET() {
  return NextResponse.json(getSystemStatus());
}
