import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export async function uploadArtifactToR2(
  fileName: string,
  content: string,
  contentType: string
) {
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

  const publicUrl = process.env.R2_PUBLIC_URL ?? "";
  const location = publicUrl ? `${publicUrl.replace(/\/$/, "")}/${fileName}` : `r2://${bucket}/${fileName}`;

  return {
    storage: "r2" as const,
    location
  };
}
