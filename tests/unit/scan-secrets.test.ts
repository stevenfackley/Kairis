import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

type Plant = { kind: string; text: string; file: string; encoding?: BufferEncoding };

const PLANTED: Plant[] = SAMPLES.map(([kind, text]) => ({
  kind,
  text,
  file: `${PLANT_DIR}/${kind.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`
}));

const FAKE_KEY_ID = ["AK", "IA", "FAKE".repeat(4)].join("");

// Next.js route folders have square brackets in their names, and PowerShell reads those as a wildcard
// when it is handed such a path as a pattern. The sign-in route lives in such a folder.
PLANTED.push({
  kind: "secret under a [bracketed] route folder",
  text: FAKE_KEY_ID,
  file: `${PLANT_DIR}/[...slug]/[id]/route.txt`
});

// The scan used to read a list of folders. These two places were never on it.
PLANTED.push({ kind: "secret in a file at the repo root", text: FAKE_KEY_ID, file: "planted-at-root.txt" });
PLANTED.push({ kind: "secret under .github", text: FAKE_KEY_ID, file: ".github/planted.txt" });

// git takes UTF-16 text for binary and does not search it; the scan decodes such files itself.
PLANTED.push({
  kind: "secret in a UTF-16 file",
  text: `﻿{"key":"${FAKE_KEY_ID}"}\r\n`,
  file: `${PLANT_DIR}/utf16.json`,
  encoding: "utf16le"
});

// A file git ignores is not part of a commit, and the scan must not open it (a local .env is one).
const IGNORED_PLANT: Plant = { kind: "ignored file", text: FAKE_KEY_ID, file: "node_modules/planted/key.txt" };

// The same ignored folder, but force-added: the file is tracked, so it must be read whatever .gitignore
// says. `git grep --untracked` alone passes over it, which is why the scan searches tracked and new files
// in two calls.
const FORCE_ADDED_PLANT: Plant = {
  kind: "force-added file in an ignored folder",
  text: FAKE_KEY_ID,
  file: "node_modules/planted/force-added.txt"
};

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
  // The scan asks git which files to read, so the copy has to be a checkout of its own: left as plain
  // files it would sit inside this repo's ignored node_modules, and git would list nothing in it.
  // Everything copied is added, ignored or not, because that is the list this function was given.
  for (const args of [
    ["init", "--quiet"],
    ["add", "--all", "--force"]
  ]) {
    const made = spawnSync("git", args, { cwd: to, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (made.error || made.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed in the copy: ${made.error?.message ?? made.stderr}`);
    }
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
  // A hit is printed as two spaces, then git's own "path:line:text", the path relative to the repo root.
  const lines = stripVTControlCharacters(run.stdout).split(/\r?\n/);
  const hits = lines.flatMap((line) => {
    const match = /^ {2}(.+?):(\d+):/.exec(line);
    return match ? [`${match[1]!}:${match[2]!}`] : [];
  });
  return { status: run.status, hits, bannedPackage: lines.some((line) => line.includes("Banned package")) };
}

describe("scripts/scan-secrets.ps1", () => {
  let root: string;
  let clean: Scan;
  let planted: Scan;

  beforeAll(() => {
    // Under node_modules, not os.tmpdir(): the system temp folder can be a network drive, and this copies
    // the whole checkout on every run. node_modules is local, already ignored by git, and not scanned.
    const scratch = path.join(REPO, "node_modules", ".cache");
    mkdirSync(scratch, { recursive: true });
    root = realpathSync.native(mkdtempSync(path.join(scratch, "kairis-scan-")));
    copyCheckout(root);
    clean = scan(root);
    for (const { file, text, encoding } of [...PLANTED, IGNORED_PLANT, FORCE_ADDED_PLANT]) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text, encoding ?? "utf8");
    }
    const added = spawnSync("git", ["add", "--force", "--", FORCE_ADDED_PLANT.file], { cwd: root, encoding: "utf8" });
    if (added.error || added.status !== 0) {
      throw new Error(`git add --force failed in the copy: ${added.error?.message ?? added.stderr}`);
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

  it("reads a force-added file, and no other file git ignores", () => {
    expect(planted.hits.filter((hit) => hit.startsWith("node_modules/"))).toEqual([`${FORCE_ADDED_PLANT.file}:1`]);
  });
});
