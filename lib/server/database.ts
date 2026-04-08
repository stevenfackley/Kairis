import { Pool } from "pg";
import { env } from "@/lib/env";

let pool: Pool | null = null;

export function getDatabasePool() {
  if (!env.databaseConfigured) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 4
    });
  }

  return pool;
}
