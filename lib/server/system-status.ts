import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export type SystemStatus = {
  app: string;
  appEnv: string;
  exchangeProvider: string;
  liveAssistedTradingEnabled: boolean;
  storage: {
    persistence: "supabase" | "local";
    artifacts: "r2" | "local";
  };
  services: {
    supabase: "configured" | "missing";
    supabaseAdmin: "configured" | "missing";
    r2: "configured" | "missing";
    coinbase: "configured" | "missing";
  };
};

export function getSystemStatus(): SystemStatus {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    app: env.appName,
    appEnv: env.appEnv,
    exchangeProvider: env.exchangeProvider,
    liveAssistedTradingEnabled: env.assistedLiveTradingEnabled,
    storage: {
      persistence: supabaseAdmin ? "supabase" : "local",
      artifacts: env.r2Configured ? "r2" : "local"
    },
    services: {
      supabase: env.supabaseConfigured ? "configured" : "missing",
      supabaseAdmin: supabaseAdmin ? "configured" : "missing",
      r2: env.r2Configured ? "configured" : "missing",
      coinbase:
        Boolean(process.env.COINBASE_API_KEY_ID) &&
        Boolean(process.env.COINBASE_API_KEY_SECRET)
          ? "configured"
          : "missing"
    }
  };
}
