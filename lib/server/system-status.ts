import { env } from "@/lib/env";
export type SystemStatus = { app: string; appEnv: string; realm: string; liveAssistedTradingEnabled: boolean; autoModeEnabled: boolean; services: { database: "configured" | "missing"; r2: "configured" | "missing"; secretKey: "configured" | "missing" } };
export function getSystemStatus(): SystemStatus {
  return { app: env.appName, appEnv: env.appEnv, realm: env.realm, liveAssistedTradingEnabled: env.liveAssistedTradingEnabled, autoModeEnabled: env.autoModeEnabled, services: { database: env.databaseUrl ? "configured" : "missing", r2: env.r2Configured ? "configured" : "missing", secretKey: env.secretKey ? "configured" : "missing" } };
}
