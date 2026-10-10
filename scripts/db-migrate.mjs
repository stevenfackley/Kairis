import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

async function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);

  try {
    const content = await fs.readFile(filePath, "utf8");

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Missing env files are fine here; explicit shell env still wins.
  }
}

function isLocalHost(connectionString) {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

await loadEnvFile(".env");
await loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const entries = await fs.readdir(migrationsDir);
const files = entries.filter((name) => name.endsWith(".sql")).sort();

if (files.length === 0) {
  console.log("No SQL migrations found.");
  process.exit(0);
}

// Works through the Supavisor transaction pooler: each migration runs inside one explicit
// transaction, so it stays on a single backend; no session state is relied on between them.
const client = new Client({
  connectionString: databaseUrl,
  ssl: isLocalHost(databaseUrl) ? false : { rejectUnauthorized: false }
});

await client.connect();

let exitCode = 0;

try {
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const applied = await client.query("select name from schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));

  for (const file of files) {
    if (appliedNames.has(file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}`);

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.error(`Migration ${file} failed:`, error instanceof Error ? error.message : error);
      exitCode = 1;
      break;
    }
  }

  if (exitCode === 0) {
    console.log("Database migrations applied.");
  }
} finally {
  await client.end();
}

process.exit(exitCode);
