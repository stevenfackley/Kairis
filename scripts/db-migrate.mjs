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

await loadEnvFile(".env");
await loadEnvFile(".env.local");

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL ??
  "";

if (!databaseUrl) {
  console.error("Missing DATABASE_URL, POSTGRES_URL, or NEON_DATABASE_URL.");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const entries = await fs.readdir(migrationsDir);
const files = entries.filter((name) => name.endsWith(".sql")).sort();

if (files.length === 0) {
  console.log("No SQL migrations found.");
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

try {
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, "utf8");
    console.log(`Applying ${file}`);
    await client.query(sql);
  }

  console.log("Database migrations applied.");
} finally {
  await client.end();
}
