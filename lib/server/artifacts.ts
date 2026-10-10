import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
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

/**
 * Streams a local export back. Only the file name of the stored location is used, resolved inside the
 * exports folder, so a stored path can never reach outside it. Null when the file is gone.
 */
export async function readArtifactFile(location: string): Promise<ReadableStream<Uint8Array> | null> {
  const fileName = path.basename(location.replaceAll("\\", "/"));
  if (!fileName || fileName === "." || fileName === "..") {
    return null;
  }
  const fullPath = path.join(localExportsDir(), fileName);
  try {
    if (!(await stat(fullPath)).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return Readable.toWeb(createReadStream(fullPath)) as ReadableStream<Uint8Array>;
}
