import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const region = config.awsRegion;
const bucket = config.knowledgeS3Bucket;
const prefix = config.knowledgeS3Prefix;

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region });
  }
  return client;
}

/**
 * Build S3 key: prefix/barbershopId/documentId/originalFileName
 */
export function buildKnowledgeKey(
  barbershopId: string,
  documentId: string,
  originalFilename: string
): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return `${prefix}/${barbershopId}/${documentId}/${safeName}`;
}

/**
 * Generate presigned PUT URL for direct upload from front. Expires in 15 min.
 */
export async function createPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900
): Promise<string> {
  if (!bucket) throw new Error("KNOWLEDGE_S3_BUCKET is not set");
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

/**
 * Get object as Buffer (for worker). Returns null if key does not exist.
 */
export async function getObjectAsBuffer(key: string): Promise<Buffer | null> {
  if (!bucket) throw new Error("KNOWLEDGE_S3_BUCKET is not set");
  try {
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = response.Body;
    if (!body) return null;
    const nodeStream = body as import("stream").Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const bufs: Buffer[] = [];
      nodeStream.on("data", (chunk: Buffer) => bufs.push(chunk));
      nodeStream.on("end", () => resolve(Buffer.concat(bufs)));
      nodeStream.on("error", reject);
    });
  } catch (e) {
    const code = (e as { name?: string }).name;
    if (code === "NoSuchKey") return null;
    throw e;
  }
}

/**
 * Get object from S3 (for worker). Returns body stream. Use getObjectAsBuffer for full buffer.
 */
export async function getObject(key: string): Promise<import("stream").Readable | null> {
  if (!bucket) throw new Error("KNOWLEDGE_S3_BUCKET is not set");
  try {
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return (response.Body as import("stream").Readable) ?? null;
  } catch (e) {
    const code = (e as { name?: string }).name;
    if (code === "NoSuchKey") return null;
    throw e;
  }
}

/**
 * Delete object from S3.
 */
export async function deleteObject(key: string): Promise<void> {
  if (!bucket) throw new Error("KNOWLEDGE_S3_BUCKET is not set");
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Check if object exists.
 */
export async function objectExists(key: string): Promise<boolean> {
  if (!bucket) return false;
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const code = (e as { name?: string }).name;
    if (code === "NotFound" || code === "NoSuchKey") return false;
    throw e;
  }
}

export function isKnowledgeStorageConfigured(): boolean {
  return Boolean(bucket);
}
