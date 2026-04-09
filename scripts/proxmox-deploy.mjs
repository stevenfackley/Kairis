import { spawnSync } from "node:child_process";
import process from "node:process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Kairis Proxmox test deployment");
console.log("1. Running repo preflight.");
run("node", ["scripts/proxmox-preflight.mjs"]);

console.log("2. Next host commands:");
console.log("   git pull");
console.log("   docker compose -f docker-compose.proxmox-test.yml up -d --build");
console.log("   docker compose -f docker-compose.proxmox-test.yml ps");
console.log("   curl http://localhost:3000/api/health");
console.log("   curl http://localhost:3000/api/system/status");

console.log("3. Expected readiness:");
console.log("   - database: configured");
console.log("   - databaseProvider: supabase");
console.log("   - storage.persistence: postgres");
console.log("   - r2: configured");
console.log("   - coinbase: missing");
