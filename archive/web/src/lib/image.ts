import sharp from "sharp";

export type ImageVariant = "photo" | "screenshot" | "logo" | "signature";

export type CompressedImage = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  bytes: number;
};

export class ImageError extends Error {}

const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB pre-compression
const MAX_OUTPUT_BYTES = 500 * 1024;      // 500 KB post-compression cap (PLAN §1.5)

const VARIANT_OPTS: Record<
  ImageVariant,
  { maxW: number; maxH: number; format: "jpeg" | "png" | "webp"; quality: number }
> = {
  photo:      { maxW: 800,  maxH: 1000, format: "jpeg", quality: 78 },
  screenshot: { maxW: 1080, maxH: 1920, format: "jpeg", quality: 72 },
  logo:       { maxW: 800,  maxH: 800,  format: "png",  quality: 90 },
  signature:  { maxW: 800,  maxH: 400,  format: "png",  quality: 90 },
};

/**
 * Compress an arbitrary user-uploaded image to a known-good variant.
 * Throws ImageError on anything we don't want to store.
 */
export async function compressImage(
  input: Buffer | Uint8Array,
  variant: ImageVariant
): Promise<CompressedImage> {
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw new ImageError(`Image too large: ${input.byteLength} bytes`);
  }

  const opts = VARIANT_OPTS[variant];
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  let pipeline = sharp(buf, { failOn: "error" })
    .rotate() // honour EXIF orientation
    .resize({
      width: opts.maxW,
      height: opts.maxH,
      fit: "inside",
      withoutEnlargement: true,
    });

  let contentType: CompressedImage["contentType"];
  if (opts.format === "jpeg") {
    pipeline = pipeline.jpeg({ quality: opts.quality, mozjpeg: true });
    contentType = "image/jpeg";
  } else if (opts.format === "webp") {
    pipeline = pipeline.webp({ quality: opts.quality });
    contentType = "image/webp";
  } else {
    pipeline = pipeline.png({ quality: opts.quality, compressionLevel: 9 });
    contentType = "image/png";
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  if (data.byteLength > MAX_OUTPUT_BYTES) {
    throw new ImageError(
      `Compressed image still too large: ${data.byteLength} bytes (cap ${MAX_OUTPUT_BYTES})`
    );
  }

  return {
    buffer: data,
    contentType,
    width: info.width,
    height: info.height,
    bytes: data.byteLength,
  };
}
