import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();

const requiredFiles = [
  "Dockerfile",
  "docker-compose.proxmox-test.yml",
  ".env.proxmox-test",
  "package.json"
];

const requiredEnv = [
  "NEXT_PUBLIC_APP_NAME",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_DEFAULT_MODE",
  "DATABASE_URL",
  "EXCHANGE_PROVIDER",
  "ENABLE_LIVE_ASSISTED_TRADING",
  "APP_BASE_URL",
  "LOCAL_DATA_DIR"
];

const recommendedEmptyForTest = [
  "COINBASE_API_KEY_ID",
  "COINBASE_API_KEY_SECRET"
];

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const entries = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    entries.set(key, value);
  }

  return entries;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

console.log("Kairis Proxmox preflight");

for (const relativePath of requiredFiles) {
  const fullPath = path.join(cwd, relativePath);

  if (!fs.existsSync(fullPath)) {
    fail(`Missing required file: ${relativePath}`);
  } else {
    console.log(`OK file: ${relativePath}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const envPath = path.join(cwd, ".env.proxmox-test");
const envEntries = parseEnvFile(envPath);

for (const key of requiredEnv) {
  const value = envEntries.get(key) ?? "";

  if (value.length === 0) {
    fail(`Missing required env value: ${key}`);
  } else {
    console.log(`OK env: ${key}`);
  }
}

const exchangeProvider = envEntries.get("EXCHANGE_PROVIDER") ?? "";
const liveAssistedTrading = envEntries.get("ENABLE_LIVE_ASSISTED_TRADING") ?? "";

if (exchangeProvider !== "mock") {
  fail(`Expected EXCHANGE_PROVIDER=mock for test, found "${exchangeProvider}"`);
} else {
  console.log("OK test mode: EXCHANGE_PROVIDER=mock");
}

if (liveAssistedTrading !== "false") {
  fail(
    `Expected ENABLE_LIVE_ASSISTED_TRADING=false for test, found "${liveAssistedTrading}"`
  );
} else {
  console.log("OK safety gate: ENABLE_LIVE_ASSISTED_TRADING=false");
}

for (const key of recommendedEmptyForTest) {
  const value = envEntries.get(key) ?? "";

  if (value.length > 0) {
    console.warn(`WARN: ${key} is set in test env; keep live exchange creds out unless needed.`);
  }
}

const localDataDir = envEntries.get("LOCAL_DATA_DIR") ?? ".local-data";
console.log(`INFO local data dir in container: ${localDataDir}`);

if (!process.exitCode) {
  console.log("Preflight passed.");
}
