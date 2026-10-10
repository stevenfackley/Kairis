import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

// Local fallback for exports when R2 is not configured. resolve() keeps an absolute LOCAL_DATA_DIR as is.
export function localExportsDir(): string {
  return path.resolve(process.cwd(), env.localDataDir, "exports");
}

export async function writeArtifactFile(fileName: string, content: string): Promise<string> {
  if (path.basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    throw new Error(`Invalid artifact file name: ${fileName}`);
  }
  const dir = localExportsDir();
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, content, "utf8");
  return fullPath;
}
