import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseDir = path.join(process.cwd(), ".local-data");

async function ensureBaseDir() {
  await mkdir(baseDir, { recursive: true });
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  await ensureBaseDir();
  const filePath = path.join(baseDir, fileName);

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    await writeJsonFile(fileName, fallback);
    return fallback;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  await ensureBaseDir();
  const filePath = path.join(baseDir, fileName);
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function writeArtifactFile(
  fileName: string,
  content: string
): Promise<string> {
  await ensureBaseDir();
  const exportsDir = path.join(baseDir, "exports");
  await mkdir(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}
