import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "../..");
const PLANT_DIR = "tests/fixtures/planted";

// Every sample is put together at run time and is plainly fake. Written out whole, it would be a secret
// shape in this file, and the scan reads this file too.
const SAMPLES: Array<[kind: string, text: string]> = [
  ["Application Insights connection string", ["Instrumentation", "Key=00000000-0000-0000-0000-000000000000"].join("")],
  ["Sentry DSN", ["https://", "0".repeat(32), "@o0.ingest.", "sentry.io/0"].join("")],
  ["AWS long-term access key id", ["AK", "IA", "FAKE".repeat(4)].join("")],
  ["AWS temporary access key id", ["AS", "IA", "FAKE".repeat(4)].join("")],
  ["Slack bot token", ["xo", "xb", "-0000-0000-FAKE"].join("")],
  ["Stripe live secret key", ["sk", "live", "FAKE0NOT0A0KEY"].join("_")],
  ["Anthropic API key", ["sk", "ant", "FAKE-NOT-A-KEY"].join("-")],
  ["GitHub personal access token", ["gh", "p_", "FAKE".repeat(9)].join("")],
  ...["RSA", "OPENSSH", "EC", "PGP"].map((label): [string, string] => [
    `${label} private key block`,
    `${["-----BEGIN", label, "PRIVATE KEY-----"].join(" ")}\nFAKE-NOT-A-KEY\n`
  ])
];

const PLANTED = SAMPLES.map(([kind, text]) => ({
  kind,
  text,
  file: `${PLANT_DIR}/${kind.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`
}));

type Scan = { status: number | null; hits: string[]; bannedPackage: boolean };

// Only what git tracks or would add is copied: a working tree can also hold ignored local files
// (Terraform state, provider binaries) that a clean checkout does not have.
function copyCheckout(to: string): void {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (listed.error || listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.error?.message ?? listed.stderr}`);
  }
  for (const file of listed.stdout.split("\0")) {
    const from = path.join(REPO, file);
    if (!file || !existsSync(from)) continue;
    const target = path.join(to, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(from, target);
  }
}

// Runs the copy's own script from the copy's root, the way `pwsh scripts/scan-secrets.ps1` runs in a checkout.
// Hits come back as "path:line" only, so a failure names the place without repeating what was found there.
function scan(root: string): Scan {
  const run = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "scripts", "scan-secrets.ps1")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (run.error) {
    throw new Error(`scripts/scan-secrets.ps1 needs PowerShell 7 (pwsh) on PATH: ${run.error.message}`);
  }
  const marker = path.basename(root);
  const lines = stripVTControlCharacters(run.stdout).split(/\r?\n/);
  const hits = lines.flatMap((line) => {
    const match = /^ {2}(.+?):(\d+): /.exec(line);
    if (!match) return [];
    const file = match[1]!.replaceAll("\\", "/");
    return [`${file.slice(file.indexOf(marker) + marker.length + 1)}:${match[2]}`];
  });
  return { status: run.status, hits, bannedPackage: lines.some((line) => line.includes("Banned package")) };
}

describe("scripts/scan-secrets.ps1", () => {
  let root: string;
  let clean: Scan;
  let planted: Scan;

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "kairis-scan-")));
    copyCheckout(root);
    clean = scan(root);
    for (const { file, text } of PLANTED) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    planted = scan(root);
  }, 120_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("passes on a clean checkout", () => {
    expect(clean.hits).toEqual([]);
    expect(clean.bannedPackage).toBe(false);
    expect(clean.status).toBe(0);
  });

  it.each(PLANTED)("still catches a planted $kind", ({ file }) => {
    expect(planted.status).toBe(1);
    expect(planted.hits).toContain(`${file}:1`);
  });
});
