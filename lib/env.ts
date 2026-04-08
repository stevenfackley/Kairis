const requiredPublicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Kairis",
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  defaultMode: process.env.NEXT_PUBLIC_DEFAULT_MODE ?? "paper",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000"
};

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL ??
  "";

export const env = {
  ...requiredPublicEnv,
  databaseUrl,
  databaseProvider: process.env.DATABASE_PROVIDER ?? (databaseUrl ? "neon" : "local"),
  exchangeProvider: process.env.EXCHANGE_PROVIDER ?? "mock",
  assistedLiveTradingEnabled: process.env.ENABLE_LIVE_ASSISTED_TRADING === "true",
  databaseConfigured: databaseUrl.length > 0,
  r2Configured:
    Boolean(process.env.R2_ACCOUNT_ID) &&
    Boolean(process.env.R2_ACCESS_KEY_ID) &&
    Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
    Boolean(process.env.R2_BUCKET)
};
