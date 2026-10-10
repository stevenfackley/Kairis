import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";

  if (!env.r2Configured || !accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
}

/**
 * Uploads an export and returns its R2 object key as the location. The bucket is private: files are
 * served through the authenticated /app/reports/download/[id] route, never a public URL.
 */
export async function uploadArtifactToR2(fileName: string, content: string, contentType: string) {
  const client = createR2Client();
  const bucket = process.env.R2_BUCKET ?? "";

  if (!client || !bucket) {
    return null;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: fileName,
      Body: content,
      ContentType: contentType
    })
  );

  return {
    storage: "r2" as const,
    location: fileName
  };
}

/**
 * Bucket and key for a stored R2 location. New rows store the bare object key; older rows stored
 * `r2://<bucket>/<key>` or, when R2_PUBLIC_URL was set, `<public url>/<key>`.
 */
export function parseR2Location(location: string, defaultBucket: string, publicUrl = ""): { bucket: string; key: string } {
  if (location.startsWith("r2://")) {
    const rest = location.slice("r2://".length);
    const slash = rest.indexOf("/");
    return slash > 0 ? { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) } : { bucket: defaultBucket, key: rest };
  }
  if (/^https?:\/\//i.test(location)) {
    const base = publicUrl.replace(/\/+$/, "");
    if (base && location.startsWith(`${base}/`)) {
      return { bucket: defaultBucket, key: decodeURIComponent(location.slice(base.length + 1)) };
    }
    return { bucket: defaultBucket, key: decodeURIComponent(new URL(location).pathname.replace(/^\/+/, "")) };
  }
  return { bucket: defaultBucket, key: location };
}

export class R2UnavailableError extends Error {}
export class R2NotFoundError extends Error {}

/** Streams a stored export back from R2. */
export async function getArtifactFromR2(location: string): Promise<ReadableStream<Uint8Array>> {
  const client = createR2Client();
  const configuredBucket = process.env.R2_BUCKET ?? "";
  if (!client || !configuredBucket) {
    throw new R2UnavailableError("Export storage (R2) is not configured on this server.");
  }
  const { bucket, key } = parseR2Location(location, configuredBucket, process.env.R2_PUBLIC_URL ?? "");
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) {
      throw new R2NotFoundError("This export file is no longer available.");
    }
    return result.Body.transformToWebStream();
  } catch (error) {
    const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
    if (name === "NoSuchKey" || name === "NotFound") {
      throw new R2NotFoundError("This export file is no longer available.");
    }
    throw error;
  }
}
