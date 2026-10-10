import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Liveness only: no database or network calls here (the readiness report is /api/system/status).
export function GET() {
  return NextResponse.json({
    app: env.appName,
    status: "ok",
    appEnv: env.appEnv
  });
}
