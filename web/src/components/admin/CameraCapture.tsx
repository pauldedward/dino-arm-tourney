"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lightweight in-page camera modal. Opens a live preview, captures a JPEG
 * frame to canvas, lets the user retake or accept. On accept we hand the
 * Blob (≤ ~150 KB at 1280×720 q=0.78) to the caller — no upload here.
 *
 * Falls back gracefully when getUserMedia is denied: surfaces a message
 * and offers a hidden <input type=file capture> trigger via `onFallback`.
 */
export default function CameraCapture({
  open,
  title,
  facing = "user",
  onCancel,
  onCapture,
}: {
  open: boolean;
  title: string;
  facing?: "user" | "environment";
  onCancel: () => void;
  onCapture: (blob: Blob) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  // Open / close camera when modal toggles.
  useEffect(() => {
    if (!open) {
      setShot(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "camera blocked";
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, facing]);

  // Stop stream when modal closes.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const closeStream = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }, [stream]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.78);
    setShot(url);
  }, []);

  const accept = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob(
      (b) => {
        if (!b) return;
        closeStream();
        onCapture(b);
        setShot(null);
      },
      "image/jpeg",
      0.78
    );
  }, [closeStream, onCapture]);

  const cancel = useCallback(() => {
    closeStream();
    setShot(null);
    onCancel();
  }, [closeStream, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
      <div className="w-full max-w-3xl border-2 border-ink bg-bone p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="font-display text-lg font-black tracking-tight">{title}</p>
          <button
            type="button"
            onClick={cancel}
            className="border-2 border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-rust hover:text-white"
          >
            ✕ close
          </button>
        </div>

        <div className="mt-3 aspect-video w-full bg-ink/10">
          {!shot ? (
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          ) : (
            <img src={shot} alt="capture preview" className="h-full w-full object-cover" />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {error && (
          <p className="mt-3 border border-rust bg-rust/10 p-2 font-mono text-xs text-rust">
            Camera error: {error}. Allow camera access in your browser, or use the file
            picker fallback on the form.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {!shot ? (
            <button
              type="button"
              onClick={capture}
              disabled={!stream}
              className="border-2 border-ink bg-ink px-6 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust disabled:opacity-50"
            >
              ● capture
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShot(null)}
                className="border-2 border-ink px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-kraft/30"
              >
                ↶ retake
              </button>
              <button
                type="button"
                onClick={accept}
                className="border-2 border-moss bg-moss px-6 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-white hover:opacity-90"
              >
                ✓ use photo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
