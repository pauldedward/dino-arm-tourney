import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 storage wrapper. S3-compatible API over a custom endpoint.
 *
 * Two buckets are used:
 *   - public: logos, banners, signature images (served directly via r2.dev URL)
 *   - private: athlete photos, payment screenshots, weigh-in photos
 *     (fetched via short-lived signed URLs)
 *
 * Env:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_PUBLIC_BUCKET, R2_PRIVATE_BUCKET, R2_PUBLIC_BASE_URL
 */

function endpoint() {
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: endpoint(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export type BucketKind = "public" | "private";

function bucketFor(kind: BucketKind): string {
  return kind === "public"
    ? process.env.R2_PUBLIC_BUCKET!
    : process.env.R2_PRIVATE_BUCKET!;
}

export interface PutResult {
  key: string;
  bucket: BucketKind;
  bytes: number;
  /** Direct browser-reachable URL (only valid for public bucket). */
  publicUrl: string | null;
}

export async function putObject(
  kind: BucketKind,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<PutResult> {
  const bucket = bucketFor(kind);
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: kind === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
    })
  );
  return {
    key,
    bucket: kind,
    bytes: body.byteLength,
    publicUrl:
      kind === "public" && process.env.R2_PUBLIC_BASE_URL
        ? `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`
        : null,
  };
}

/**
 * Presigned GET URL for a private-bucket object.
 * Default TTL = 5 minutes (operator clicks a photo → URL is short-lived).
 */
export async function signedUrl(key: string, ttlSeconds = 300): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucketFor("private"),
      Key: key,
    }),
    { expiresIn: ttlSeconds }
  );
}

export async function deleteObject(kind: BucketKind, key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: bucketFor(kind), Key: key })
  );
}

/**
 * Fetch a private-bucket object and return its bytes + content-type.
 * Used by server-side renderers (PDF) that need to inline images as
 * data URIs rather than letting the client follow a signed URL.
 */
export async function getObjectBytes(
  kind: BucketKind,
  key: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucketFor(kind), Key: key })
    );
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) return null;
    const bytes = Buffer.from(await body.transformToByteArray());
    return {
      bytes,
      contentType: res.ContentType ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

/** Build a storage key scoped to an event + purpose. */
export function mediaKey(
  eventId: string,
  purpose:
    | "reg-photo"
    | "payment-proof"
    | "weigh-in"
    | "logo"
    | "banner"
    | "signature"
    | "poster"
    | "circular",
  id: string,
  ext = "jpg"
): string {
  return `events/${eventId}/${purpose}/${id}.${ext}`;
}
