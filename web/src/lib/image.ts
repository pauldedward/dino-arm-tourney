import sharp from "sharp";

/**
 * Server-side image pipeline. Every public-facing upload (registration
 * photo, weigh-in photo, UPI screenshot) MUST run through this before
 * being persisted to R2. Budget discipline from PLAN-WEEK1 §1.5.
 *
 * Rules:
 *   - accept JPEG / PNG / WebP / HEIC only
 *   - resize to max 1080 px on the longest edge
 *   - re-encode as JPEG quality 75
 *   - strip EXIF (privacy + bytes)
 *   - reject if result > 500 KB
 */

export const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_EDGE = 1080;
const JPEG_QUALITY = 75;
const MAX_BYTES = 500 * 1024;

export interface CompressedImage {
  buffer: Buffer;
  bytes: number;
  width: number;
  height: number;
  contentType: "image/jpeg";
}

export class ImageRejectedError extends Error {
  constructor(
    public readonly code:
      | "unsupported-type"
      | "too-large-after-compression"
      | "decode-failed",
    message: string
  ) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

export async function compressImage(
  input: Buffer | Uint8Array,
  mimeType: string
): Promise<CompressedImage> {
  if (!ACCEPTED_MIME.has(mimeType.toLowerCase())) {
    throw new ImageRejectedError(
      "unsupported-type",
      `unsupported mime type: ${mimeType}`
    );
  }

  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(input, { failOn: "error" })
      .rotate() // honour EXIF orientation before we strip it
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } catch (err) {
    throw new ImageRejectedError(
      "decode-failed",
      `failed to decode image: ${(err as Error).message}`
    );
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  if (data.byteLength > MAX_BYTES) {
    throw new ImageRejectedError(
      "too-large-after-compression",
      `image ${data.byteLength} bytes exceeds ${MAX_BYTES} limit`
    );
  }

  return {
    buffer: data,
    bytes: data.byteLength,
    width: info.width,
    height: info.height,
    contentType: "image/jpeg",
  };
}
