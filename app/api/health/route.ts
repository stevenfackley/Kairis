import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/server/system-status";

export function GET() {
  const status = getSystemStatus();

  return NextResponse.json({
    app: status.app,
    status: "ok",
    appEnv: status.appEnv,
    exchangeProvider: status.exchangeProvider,
    storage: status.storage
  });
}
