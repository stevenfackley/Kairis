import { parseOwnerEmails } from "@/lib/domain/owner";
const bool = (v: string | undefined) => v === "true";
export const env = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Kairis",
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  realm: process.env.QAVREN_REALM ?? "kairis",
  ownerEmails: parseOwnerEmails(process.env.KAIRIS_OWNER_EMAILS),
  secretKey: process.env.KAIRIS_SECRET_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  liveAssistedTradingEnabled: bool(process.env.ENABLE_LIVE_ASSISTED_TRADING),
  autoModeEnabled: bool(process.env.ENABLE_AUTO_MODE),
  r2Configured: Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET),
  localDataDir: process.env.LOCAL_DATA_DIR ?? ".local-data"
};
