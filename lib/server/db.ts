import { Pool, type PoolClient, type PoolConfig } from "pg";
import { env } from "@/lib/env";

// Prod runs through the Supavisor transaction pooler (:6543): every query may land on a different
// backend, so nothing here relies on session state (no SET, no named prepared statements, no
// cross-query advisory locks) and table names stay unqualified (the role's search_path picks the schema).

let pool: Pool | null = null;

function isLocalHost(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function getPool(): Pool {
  if (pool) {
    return pool;
  }
  const connectionString = env.databaseUrl;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  const config: PoolConfig = { connectionString, max: 4 };
  if (!isLocalHost(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }
  pool = new Pool(config);
  pool.on("error", (error) => {
    console.error("Postgres pool error", error);
  });
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The original error is the one worth surfacing.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase(timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = (async () => {
    try {
      await query("select 1");
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// Integration tests only: lets the suite release its sockets so vitest can exit cleanly.
export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
