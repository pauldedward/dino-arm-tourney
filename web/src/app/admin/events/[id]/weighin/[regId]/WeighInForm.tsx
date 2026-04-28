"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { enqueueWeighIn, flushQueue } from "@/lib/sync/queue";

/**
 * Weigh-in capture form.
 *
 * Two photo slots: scale-proof (-> weigh_ins.live_photo_url) and athlete
 * photo (-> registrations.photo_url, last write wins). Both optional.
 * Submission tries online first; falls back to the IndexedDB queue.
 */
export default function WeighInForm({
  registrationId,
  declared,
  queueHref,
  currentPhotoUrl,
}: {
  registrationId: string;
  declared: number | null;
  queueHref: string;
  currentPhotoUrl: string | null;
}) {
  const router = useRouter();
  const [scaleBlob, setScaleBlob] = useState<Blob | null>(null);
  const [athleteBlob, setAthleteBlob] = useState<Blob | null>(null);
  const [kg, setKg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const parsed = Number(kg);
    if (!parsed || parsed < 20 || parsed > 250) {
      setMsg("Enter a valid weight (20-250 kg).");
      return;
    }
    setBusy(true);

    const fd = new FormData();
    fd.set("registration_id", registrationId);
    fd.set("measured_kg", parsed.toFixed(2));
    if (scaleBlob) fd.set("file", scaleBlob, "scale.jpg");
    if (athleteBlob) fd.set("athlete_file", athleteBlob, "athlete.jpg");

    if (navigator.onLine) {
      try {
        const res = await fetch("/api/weighin", { method: "POST", body: fd });
        if (res.ok) {
          setBusy(false);
          setMsg("Saved.");
          router.push(queueHref);
          router.refresh();
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          const j = await res.json().catch(() => ({}));
          setBusy(false);
          setMsg(j.error ?? `request failed (${res.status})`);
          return;
        }
      } catch {
        // fall through to queue
      }
    }

    try {
      await enqueueWeighIn(fd);
    } catch (e) {
      setBusy(false);
      setMsg((e as Error).message ?? "could not queue");
      return;
    }
    setBusy(false);
    setMsg("Queued offline. Will retry when online.");
    flushQueue();
    router.push(queueHref);
  }

  async function savePhotoOnly() {
    setMsg(null);
    if (!athleteBlob) {
      setMsg("Capture an athlete photo first.");
      return;
    }
    if (!navigator.onLine) {
      setMsg("Photo-only update needs internet. Submit with weight to queue offline.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("file", athleteBlob, "athlete.jpg");
    try {
      const res = await fetch(`/api/admin/registrations/${registrationId}/photo`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        setMsg(j.error ?? `request failed (${res.status})`);
        return;
      }
      setBusy(false);
      setMsg("Photo updated.");
      setAthleteBlob(null);
      router.refresh();
    } catch (e) {
      setBusy(false);
      setMsg((e as Error).message ?? "upload failed");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 border-2 border-ink p-4 md:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <PhotoCapture
            label="Scale photo"
            hint="Show the scale display"
            badge="Proof"
            onChange={setScaleBlob}
          />
          <PhotoCapture
            label="Athlete photo"
            hint="Updates ID card on save"
            badge="Face"
            currentUrl={currentPhotoUrl}
            onChange={setAthleteBlob}
          />
        </div>
        {athleteBlob && (
          <button
            type="button"
            onClick={savePhotoOnly}
            disabled={busy}
            className="w-full border-2 border-ink bg-bone py-2 font-mono text-[11px] uppercase tracking-[0.2em] hover:bg-rust hover:text-bone disabled:opacity-40"
            title="Update the athlete photo without recording another weigh-in"
          >
            Save athlete photo only
          </button>
        )}
        <p className="font-mono text-[10px] leading-relaxed text-ink/55">
          Both photos are optional. Submit weight + photos together with the button on the right.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Measured weight (kg)
          </span>
          <input
            type="number"
            step="0.01"
            min={20}
            max={250}
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            placeholder={declared ? String(declared) : "78.40"}
            className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-2xl font-bold tracking-tight"
            required
          />
          {declared != null && (
            <span className="mt-1 block font-mono text-[10px] text-ink/50">
              Declared {declared} kg
            </span>
          )}
        </label>

        <button
          type="submit"
          disabled={busy}
          className="block w-full border-2 border-ink bg-ink py-3 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-bone hover:bg-rust hover:border-rust disabled:opacity-40"
        >
          {busy ? "Saving..." : "Record weigh-in"}
        </button>

        {msg && (
          <p
            className={`border px-3 py-2 font-mono text-xs ${
              msg.startsWith("Saved") || msg.startsWith("Photo updated")
                ? "border-moss bg-moss/10 text-moss"
                : msg.startsWith("Queued")
                  ? "border-rust bg-rust/10 text-rust"
                  : "border-rust bg-rust/10 text-rust"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Compact, self-contained capture tile. Owns its own MediaStream so two
 * tiles do not fight over the camera. Tiles release tracks on unmount
 * and on retake.
 */
function PhotoCapture({
  label,
  hint,
  badge,
  currentUrl,
  onChange,
}: {
  label: string;
  hint: string;
  badge: string;
  currentUrl?: string | null;
  onChange: (blob: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [stream, previewUrl]
  );

  useEffect(() => {
    const v = videoRef.current;
    if (v && stream) {
      v.srcObject = stream;
      v.play().catch(() => {
        /* autoplay block is fine */
      });
    }
  }, [stream]);

  async function start() {
    setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1280, height: 960 },
        audio: false,
      });
      setStream(s);
    } catch (e) {
      setErr((e as Error).message || "camera unavailable");
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }

  function snap() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        onChange(blob);
        stop();
      },
      "image/jpeg",
      0.85
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onChange(null);
  }

  const showCurrent = !previewUrl && !stream && !!currentUrl;
  const showEmpty = !previewUrl && !stream && !currentUrl;

  return (
    <div className="overflow-hidden border-2 border-ink bg-bone">
      <header className="flex items-center justify-between border-b-2 border-ink bg-kraft/30 px-2 py-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">{label}</span>
        <span className="border border-ink/60 px-1 font-mono text-[8px] uppercase tracking-[0.2em] text-ink/70">
          {badge}
        </span>
      </header>
      <div className="relative aspect-square bg-ink/5">
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${label} captured`} className="h-full w-full object-cover" />
        )}
        {stream && (
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        )}
        {showCurrent && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl!}
              alt={`${label} on file`}
              className="h-full w-full object-cover opacity-90"
            />
            <span className="pointer-events-none absolute left-1.5 top-1.5 border border-bone/70 bg-ink/70 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.2em] text-bone">
              On file
            </span>
          </>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
            No photo
          </div>
        )}
        {!stream && !previewUrl && (
          <button
            type="button"
            onClick={start}
            className="absolute inset-x-0 bottom-0 border-t border-bone/40 bg-ink/70 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-bone hover:bg-ink"
          >
            {currentUrl ? "Retake" : "Open camera"}
          </button>
        )}
        {stream && (
          <button
            type="button"
            onClick={snap}
            className="absolute inset-x-0 bottom-0 border-t border-bone/40 bg-rust py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-ink"
          >
            Capture
          </button>
        )}
        {previewUrl && (
          <button
            type="button"
            onClick={retake}
            className="absolute inset-x-0 bottom-0 border-t border-bone/40 bg-ink/70 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-bone hover:bg-ink"
          >
            Retake
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <p className="border-t-2 border-ink px-2 py-1 font-mono text-[9px] leading-tight text-ink/60">
        {err ? <span className="text-rust">Camera: {err}</span> : hint}
      </p>
    </div>
  );
}
