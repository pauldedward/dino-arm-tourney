"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteEventButton({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setConfirmText("");
          setErr(null);
        }}
        className="border border-rust px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-bone"
      >
        Delete
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md border-2 border-ink bg-bone p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-rust">
              Danger zone
            </p>
            <h2 className="mt-2 font-display text-3xl font-black tracking-tight">
              Delete event?
            </h2>
            <p className="mt-3 text-sm text-ink/80">
              This permanently removes{" "}
              <span className="font-bold">“{eventName}”</span> and all of its
              registrations, payments, brackets, matches, and media. This cannot be
              undone.
            </p>
            <label className="mt-4 block">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
                Type <span className="font-bold text-ink">DELETE</span> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                className="mt-1 w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-rust"
              />
            </label>
            {err && (
              <p className="mt-3 font-mono text-xs text-rust">Error: {err}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="border-2 border-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-ink hover:text-bone disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy || confirmText !== "DELETE"}
                className="border-2 border-rust bg-rust px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
