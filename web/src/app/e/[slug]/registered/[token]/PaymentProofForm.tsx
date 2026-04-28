"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

interface ProofRow {
  id: string;
  utr: string;
  created_at: string;
}

interface Props {
  registrationId: string;
  eventId: string;
  paymentStatus: string;
  proofs: ProofRow[];
  /** Owner can delete prior proofs; anonymous viewers (legacy public-token
   *  flow) can still add but not delete. */
  isOwner: boolean;
  accent: string;
}

export default function PaymentProofForm({
  registrationId,
  eventId,
  paymentStatus,
  proofs,
  isOwner,
  accent,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const hasAny = proofs.length > 0;
  // Auto-open the "add" form when nothing has been submitted, OR when the
  // organiser rejected what was submitted.
  const [adding, setAdding] = useState(!hasAny || paymentStatus === "rejected");
  const [utr, setUtr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Please attach a payment screenshot.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", "payment-proof");
      fd.append("event_id", eventId);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) {
        const j = await up.json().catch(() => ({}));
        throw new Error(j.error ?? "screenshot upload failed");
      }
      const upJson = await up.json();

      const res = await fetch("/api/payment/proofs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registration_id: registrationId,
          utr: utr.trim(),
          proof_key: upJson.key,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed to submit proof");
      setUtr("");
      setFile(null);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteProof(id: string) {
    if (!(await confirm({ message: "Delete this proof?", confirmLabel: "Delete", tone: "danger" }))) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/payment/proofs/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "delete failed");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  const statusLine =
    paymentStatus === "rejected"
      ? "Rejected by organiser. Please add a fresh proof."
      : hasAny
        ? "Proofs received. Our team will verify within a few hours."
        : null;

  return (
    <section
      className="mt-8 border-2 border-white/20 bg-black/20 p-6 space-y-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xs uppercase tracking-[0.3em] opacity-80">
          Step 3 · Payment proofs
        </h2>
        {hasAny && (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-70"
          >
            {proofs.length} on file
          </span>
        )}
      </div>

      {statusLine && (
        <p className="text-sm" style={{ color: accent }}>
          {statusLine}
        </p>
      )}

      {hasAny && (
        <ul className="divide-y divide-white/10 border border-white/10">
          {proofs.map((p, i) => {
            const when = new Date(p.created_at).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-50">
                    Proof {proofs.length - i}
                  </span>
                  <div className="font-mono text-xs">UTR {p.utr || "—"}</div>
                  <div className="text-[10px] opacity-50">{when}</div>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => deleteProof(p.id)}
                    disabled={!!deletingId || submitting}
                    className="font-mono text-[10px] uppercase tracking-[0.2em] underline opacity-70 hover:opacity-100 disabled:opacity-30"
                  >
                    {deletingId === p.id ? "Deleting…" : "Remove"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs opacity-60">
        Paid in two transfers? Add another proof for each UPI transaction
        until the total matches the entry fee.
      </p>

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border-2 px-4 py-2 font-display text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white/10"
          style={{ borderColor: accent, color: accent }}
        >
          Add another proof
        </button>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 border border-white/10 p-4">
          <label className="block">
            <span className="text-sm">UTR / Transaction reference</span>
            <input
              className="mt-1.5 block w-full border border-white/30 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white"
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/\D/g, ""))}
              maxLength={22}
              required
              placeholder="123456789012"
            />
          </label>

          <label className="block">
            <span className="text-sm">Screenshot of payment confirmation</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm"
              required
            />
          </label>

          {error && (
            <div className="bg-white/10 p-3 text-sm" style={{ color: accent }}>
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.2em] disabled:opacity-50"
              style={{ background: accent, color: "#0f3d2e" }}
            >
              {submitting ? "Uploading…" : "Submit proof"}
            </button>
            {hasAny && !submitting && (
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setFile(null);
                  setUtr("");
                  setError(null);
                }}
                className="font-mono text-[11px] uppercase tracking-[0.2em] underline opacity-80 hover:opacity-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && !adding && (
        <div className="bg-white/10 p-3 text-sm" style={{ color: accent }}>
          {error}
        </div>
      )}
    </section>
  );
}


