import { NextResponse } from "next/server";
import { compressImage, ImageRejectedError } from "@/lib/image";
import { putObject, mediaKey, type BucketKind } from "@/lib/storage";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs"; // sharp needs native runtime

/**
 * POST /api/upload
 *
 * Multipart body:
 *   - file:    File (image, or PDF when purpose=poster)
 *   - purpose: "reg-photo" | "payment-proof" | "weigh-in"
 *              | "logo" | "banner" | "signature" | "poster"
 *   - event_id: uuid of the owning event (scopes the key)
 *
 * Most image uploads go through sharp (1080w JPEG q=75, EXIF stripped,
 * reject > 500 KB). The `poster` purpose additionally accepts a PDF flyer
 * (up to 4 MB) which is stored as-is in the public bucket.
 *
 * Public bucket: logo/banner/signature/poster. Everything else private.
 */
const PUBLIC_PURPOSES = new Set(["logo", "banner", "signature", "poster", "circular"]);
const ALL_PURPOSES = [
  "reg-photo",
  "payment-proof",
  "weigh-in",
  "logo",
  "banner",
  "signature",
  "poster",
  "circular",
] as const;
type Purpose = (typeof ALL_PURPOSES)[number];

const POSTER_PDF_MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const CIRCULAR_PDF_MAX_BYTES = 8 * 1024 * 1024; // 8 MB — federations’ circulars run long
const PAYMENT_PROOF_PDF_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — UPI receipt PDFs

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  const purpose = String(form.get("purpose") ?? "") as Purpose;
  const eventId = String(form.get("event_id") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!purpose || !eventId) {
    return NextResponse.json(
      { error: "purpose and event_id are required" },
      { status: 400 }
    );
  }
  if (!(ALL_PURPOSES as readonly string[]).includes(purpose)) {
    return NextResponse.json({ error: "unknown purpose" }, { status: 400 });
  }

  const rawBuf = Buffer.from(await file.arrayBuffer());
  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf";

  // PDF path — allowed for poster, circular, and payment-proof.
  if (isPdf) {
    if (
      purpose !== "poster" &&
      purpose !== "circular" &&
      purpose !== "payment-proof"
    ) {
      return NextResponse.json(
        { error: "PDF only accepted for purpose=poster, circular, or payment-proof" },
        { status: 415 }
      );
    }
    const max =
      purpose === "circular"
        ? CIRCULAR_PDF_MAX_BYTES
        : purpose === "payment-proof"
        ? PAYMENT_PROOF_PDF_MAX_BYTES
        : POSTER_PDF_MAX_BYTES;
    if (rawBuf.byteLength > max) {
      return NextResponse.json(
        {
          error: `${purpose} PDF too large: ${rawBuf.byteLength} bytes (max ${max})`,
          code: "too-large",
        },
        { status: 413 }
      );
    }
    const bucket: BucketKind = PUBLIC_PURPOSES.has(purpose) ? "public" : "private";
    const key = mediaKey(eventId, purpose, randomUUID(), "pdf");
    try {
      const put = await putObject(bucket, key, rawBuf, "application/pdf");
      return NextResponse.json({
        ok: true,
        kind: "pdf",
        key: put.key,
        bucket: put.bucket,
        bytes: put.bytes,
        publicUrl: put.publicUrl,
      });
    } catch (err) {
      console.error("[upload] R2 put (pdf) failed", err);
      return NextResponse.json({ error: "storage upload failed" }, { status: 502 });
    }
  }

  // Circular must be a PDF.
  if (purpose === "circular") {
    return NextResponse.json(
      { error: "circular must be a PDF" },
      { status: 415 }
    );
  }

  // Image path.
  let compressed;
  try {
    compressed = await compressImage(rawBuf, mime || "image/jpeg");
  } catch (err) {
    if (err instanceof ImageRejectedError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 415 }
      );
    }
    console.error("[upload] compress failed", err);
    return NextResponse.json({ error: "image processing failed" }, { status: 500 });
  }

  const bucket: BucketKind = PUBLIC_PURPOSES.has(purpose) ? "public" : "private";
  const key = mediaKey(eventId, purpose, randomUUID());

  try {
    const put = await putObject(
      bucket,
      key,
      compressed.buffer,
      compressed.contentType
    );
    return NextResponse.json({
      ok: true,
      kind: "image",
      key: put.key,
      bucket: put.bucket,
      bytes: put.bytes,
      width: compressed.width,
      height: compressed.height,
      publicUrl: put.publicUrl,
    });
  } catch (err) {
    console.error("[upload] R2 put failed", err);
    return NextResponse.json({ error: "storage upload failed" }, { status: 502 });
  }
}
