import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { getSystemStatus } from "@/lib/server/system-status";

/**
 * Readiness report. Anyone (and the post-deploy check) gets whether the database answers; the full
 * configuration picture (realm, R2, secret key, feature flags) is for the owner only.
 */
export async function GET() {
  const status = await getSystemStatus();
  const user = await currentUser().catch(() => null);
  if (user?.isOwner) return NextResponse.json(status);
  return NextResponse.json({
    app: status.app,
    appEnv: status.appEnv,
    services: { database: status.services.database }
  });
}
