import { env } from "@/lib/env";
import { getDatabasePool } from "@/lib/server/database";

export type SystemStatus = {
  app: string;
  appEnv: string;
  exchangeProvider: string;
  liveAssistedTradingEnabled: boolean;
  storage: {
    persistence: "postgres" | "local";
    artifacts: "r2" | "local";
  };
  services: {
    database: "configured" | "missing";
    databaseProvider: string;
    r2: "configured" | "missing";
    coinbase: "configured" | "missing";
  };
};

export function getSystemStatus(): SystemStatus {
  const database = getDatabasePool();

  return {
    app: env.appName,
    appEnv: env.appEnv,
    exchangeProvider: env.exchangeProvider,
    liveAssistedTradingEnabled: env.assistedLiveTradingEnabled,
    storage: {
      persistence: database ? "postgres" : "local",
      artifacts: env.r2Configured ? "r2" : "local"
    },
    services: {
      database: env.databaseConfigured ? "configured" : "missing",
      databaseProvider: env.databaseProvider,
      r2: env.r2Configured ? "configured" : "missing",
      coinbase:
        Boolean(process.env.COINBASE_API_KEY_ID) &&
        Boolean(process.env.COINBASE_API_KEY_SECRET)
          ? "configured"
          : "missing"
    }
  };
}
