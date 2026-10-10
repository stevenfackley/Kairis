import { env } from "@/lib/env";
import { pingDatabase } from "@/lib/server/db";

export type SystemStatus = {
  app: string;
  appEnv: string;
  realm: string;
  liveAssistedTradingEnabled: boolean;
  autoModeEnabled: boolean;
  services: {
    database: "connected" | "missing" | "error";
    r2: "configured" | "missing";
    secretKey: "configured" | "missing";
  };
};

// Readiness: pings the database (2 s timeout). Liveness (/api/health) must not call this.
export async function getSystemStatus(): Promise<SystemStatus> {
  const database = !env.databaseUrl ? "missing" : (await pingDatabase()) ? "connected" : "error";
  return {
    app: env.appName,
    appEnv: env.appEnv,
    realm: env.realm,
    liveAssistedTradingEnabled: env.liveAssistedTradingEnabled,
    autoModeEnabled: env.autoModeEnabled,
    services: {
      database,
      r2: env.r2Configured ? "configured" : "missing",
      secretKey: env.secretKey ? "configured" : "missing"
    }
  };
}
