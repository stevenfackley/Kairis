const requiredPublicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Kairis",
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  defaultMode: process.env.NEXT_PUBLIC_DEFAULT_MODE ?? "paper",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000"
};

export const env = {
  ...requiredPublicEnv,
  exchangeProvider: process.env.EXCHANGE_PROVIDER ?? "mock",
  assistedLiveTradingEnabled: process.env.ENABLE_LIVE_ASSISTED_TRADING === "true",
  supabaseConfigured:
    requiredPublicEnv.supabaseUrl.length > 0 &&
    requiredPublicEnv.supabaseAnonKey.length > 0,
  r2Configured:
    Boolean(process.env.R2_ACCOUNT_ID) &&
    Boolean(process.env.R2_ACCESS_KEY_ID) &&
    Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
    Boolean(process.env.R2_BUCKET)
};
