"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enqueueWeighIn } from "@/lib/sync/queue";

export default function WeighInForm({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [snapshot, setSnapshot] = useState<Blob | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [measured, setMeasured] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function startCam() {
    setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 800, height: 600 },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch {
      setMsg("Camera unavailable. You can still record without a photo.");
    }
  }

  function snap() {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (b) {
          setSnapshot(b);
          if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
          setSnapshotUrl(URL.createObjectURL(b));
        }
      },
      "image/jpeg",
      0.85
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const kg = Number(measured);
    if (!Number.isFinite(kg) || kg < 20 || kg > 250) {
      setMsg("Weight must be 20–250 kg");
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("registration_id", registrationId);
    fd.set("measured_kg", String(kg));
    if (snapshot) fd.set("photo", snapshot, "weighin.jpg");
    try {
      const res = await fetch("/api/weighin", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "failed");
      setMsg("Saved.");
      stream?.getTracks().forEach((t) => t.stop());
      router.refresh();
      router.push("/admin/weighin");
    } catch {
      // Offline — queue.
      await enqueueWeighIn(fd);
      setMsg("Offline — queued. Will sync when online.");
      router.push("/admin/weighin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-2 border-ink p-4">
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">Live photo</p>
        {!snapshot ? (
          <>
            <video ref={videoRef} className="w-full max-w-sm border-2 border-ink bg-ink/5" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            <div className="flex gap-2">
              {!stream ? (
                <button type="button" onClick={startCam} className="border-2 border-ink bg-bone px-3 py-2 font-mono text-xs uppercase hover:bg-volt">
                  Start camera
                </button>
              ) : (
                <button type="button" onClick={snap} className="border-2 border-ink bg-ink px-3 py-2 font-mono text-xs uppercase text-bone hover:bg-blood hover:border-blood">
                  Capture
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={snapshotUrl ?? ""} alt="" className="w-full max-w-sm border-2 border-ink" />
            <button
              type="button"
              onClick={() => {
                setSnapshot(null);
                if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
                setSnapshotUrl(null);
              }}
              className="font-mono text-xs underline"
            >
              Re-take
            </button>
          </>
        )}
      </div>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Measured kg</span>
        <input
          inputMode="decimal"
          value={measured}
          onChange={(e) => setMeasured(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-display text-3xl tnum focus:bg-volt focus:outline-none"
          required
        />
      </label>

      {msg && <p className="font-mono text-xs">{msg}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood disabled:opacity-50"
      >
        {busy ? "Saving…" : "Record weigh-in →"}
      </button>
    </form>
  );
}
