import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials in env");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export type R2Bucket = "public" | "private";

function bucketName(b: R2Bucket): string {
  return b === "public"
    ? process.env.R2_PUBLIC_BUCKET || "dino-arm-tourney-public"
    : process.env.R2_PRIVATE_BUCKET || "dino-arm-tourney-media";
}

export type PutOpts = {
  bucket: R2Bucket;
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
};

export async function putObject(opts: PutOpts): Promise<{ url: string | null }> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucketName(opts.bucket),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl ?? "public, max-age=31536000, immutable",
    })
  );
  if (opts.bucket === "public") {
    const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
    return { url: base ? `${base}/${opts.key}` : null };
  }
  return { url: null };
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key })
  );
}

/**
 * Presigned GET URL for a private object.
 * Use a short TTL (5 min default) — operators click through, they don't share.
 */
export async function signedUrl(
  key: string,
  ttlSeconds = 300
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucketName("private"),
      Key: key,
    }),
    { expiresIn: ttlSeconds }
  );
}

/** Stable key helpers — keep collisions impossible. */
export const keys = {
  registrationPhoto(eventSlug: string, registrationId: string): string {
    return `events/${eventSlug}/registrations/${registrationId}/photo.jpg`;
  },
  paymentProof(eventSlug: string, registrationId: string, paymentId: string): string {
    return `events/${eventSlug}/registrations/${registrationId}/proof-${paymentId}.jpg`;
  },
  weighInPhoto(eventSlug: string, registrationId: string, weighInId: string): string {
    return `events/${eventSlug}/registrations/${registrationId}/weighin-${weighInId}.jpg`;
  },
  scalePhoto(eventSlug: string, registrationId: string, weighInId: string): string {
    return `events/${eventSlug}/registrations/${registrationId}/scale-${weighInId}.jpg`;
  },
  eventLogo(eventSlug: string): string {
    return `events/${eventSlug}/branding/logo.png`;
  },
  eventBanner(eventSlug: string): string {
    return `events/${eventSlug}/branding/banner.jpg`;
  },
  eventSignature(eventSlug: string): string {
    return `events/${eventSlug}/branding/signature.png`;
  },
};
