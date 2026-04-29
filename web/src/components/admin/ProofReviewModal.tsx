"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import Spinner from "@/components/Spinner";

type ProofEntry = {
  id: string;
  utr: string | null;
  url: string | null;
  created_at?: string;
};

type ProofResponse = {
  paymentStatus?: string;
  latest: { utr: string | null; url: string | null } | null;
  history: ProofEntry[];
};

interface Props {
  paymentId: string;
  caption?: string;
  initialStatus: string;
  onClose: () => void;
  onResolved: (action: "verify" | "reject") => void;
}

function isPdf(url: string): boolean {
  const u = url.split("?")[0].toLowerCase();
  return u.endsWith(".pdf");
}

export default function ProofReviewModal({
  paymentId,
  caption,
  initialStatus,
  onClose,
  onResolved,
}: Props) {
  const confirm = useConfirm();
  const [proofs, setProofs] = useState<ProofEntry[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "reject" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/payments/${paymentId}/proof`);
        const j: ProofResponse = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError((j as unknown as { error?: string }).error ?? "load failed");
          setLoading(false);
          return;
        }
        const list: ProofEntry[] = Array.isArray(j.history) ? j.history : [];
        if (list.length === 0 && j.latest?.url) {
          list.push({ id: "latest", utr: j.latest.utr, url: j.latest.url });
        }
        setProofs(list);
        setActiveIdx(0);
        if (j.paymentStatus) setStatus(j.paymentStatus);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const decide = useCallback(
    async (action: "verify" | "reject") => {
      if (action === "reject" && !(await confirm({ message: "Reject this payment?", confirmLabel: "Reject", tone: "danger" }))) return;
      setBusy(action);
      setError(null);
      try {
        const res = await fetch(`/api/admin/payments/${paymentId}/${action}`, {
          method: "POST",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.error ?? "action failed");
          setBusy(null);
          return;
        }
        setStatus(action === "verify" ? "verified" : "rejected");
        setBusy(null);
        onResolved(action);
      } catch (e) {
        setError((e as Error).message);
        setBusy(null);
      }
    },
    [paymentId, onResolved]
  );

  // Esc closes; arrow keys switch proof.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (proofs.length < 2) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(proofs.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proofs.length, onClose]);

  const active = proofs[activeIdx] ?? null;
  const canDecide = status === "pending" && proofs.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[min(1100px,95vw)] flex-col border-2 border-ink bg-bone shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-ink bg-kraft/20 px-4 py-3">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
              Payment proof
            </p>
            <h2 className="mt-1 font-display text-2xl font-black tracking-tight">
              {caption ?? "Review payment"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <button
              type="button"
              onClick={onClose}
              className="border-2 border-ink px-3 py-1 font-mono text-[12px] uppercase tracking-[0.2em] hover:bg-rust hover:text-white"
              aria-label="Close"
            >
              Esc ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left rail — list */}
          <aside className="flex w-64 shrink-0 flex-col border-r-2 border-ink">
            <div className="flex min-h-[28px] items-center border-b border-ink/30 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.2em] text-ink/60">
              {loading ? (
                <Spinner variant="inline" label="Loading" />
              ) : (
                `${proofs.length} document${proofs.length === 1 ? "" : "s"}`
              )}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {proofs.map((p, idx) => {
                const isActive = idx === activeIdx;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={`block w-full border-b border-ink/10 px-3 py-2 text-left font-mono text-[13px] ${
                        isActive ? "bg-rust/10 text-ink" : "hover:bg-kraft/20"
                      }`}
                    >
                      <span className="block text-[12px] uppercase tracking-[0.2em] text-ink/40">
                        #{idx + 1}
                        {p.url && isPdf(p.url) ? " · pdf" : " · img"}
                      </span>
                      <span className="mt-1 block truncate font-semibold">
                        UTR {p.utr ?? "—"}
                      </span>
                      {p.created_at && (
                        <span className="mt-0.5 block text-[12px] text-ink/40">
                          {new Date(p.created_at).toLocaleString()}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {!loading && proofs.length === 0 && (
                <li className="px-3 py-6 text-center font-mono text-[12px] text-ink/40">
                  No proofs uploaded
                </li>
              )}
            </ul>
          </aside>

          {/* Preview */}
          <section className="flex min-w-0 flex-1 items-center justify-center bg-ink/5 p-3">
            {loading && <Spinner variant="card" label="Loading proofs" />}
            {error && !loading && (
              <p className="font-mono text-[13px] text-rust">{error}</p>
            )}
            {!loading && !error && active?.url ? (
              isPdf(active.url) ? (
                <iframe
                  src={active.url}
                  title={`Proof ${activeIdx + 1}`}
                  className="h-full w-full border border-ink/20 bg-white"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={active.url}
                  alt={`Proof ${activeIdx + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              )
            ) : (
              !loading &&
              !error && (
                <p className="font-mono text-[13px] text-ink/40">
                  Select a document on the left.
                </p>
              )
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t-2 border-ink bg-kraft/10 px-4 py-3">
          <div className="font-mono text-[13px] text-ink/60">
            {active?.url && (
              <a
                href={active.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline hover:text-rust"
              >
                Open in new tab ↗
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canDecide ? (
              <>
                <button
                  type="button"
                  onClick={() => decide("reject")}
                  disabled={!!busy}
                  className="border-2 border-rust px-4 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white disabled:opacity-40"
                >
                  {busy === "reject" ? "…" : "Reject"}
                </button>
                <button
                  type="button"
                  onClick={() => decide("verify")}
                  disabled={!!busy}
                  className="border-2 border-moss bg-moss px-4 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-white disabled:opacity-40"
                >
                  {busy === "verify" ? "…" : "Verify"}
                </button>
              </>
            ) : (
              <span className="font-mono text-[13px] text-ink/50">
                {status === "verified"
                  ? "Already verified"
                  : status === "rejected"
                    ? "Already rejected"
                    : "No proof to decide"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "verified"
      ? "border-moss bg-moss text-white"
      : status === "rejected"
        ? "border-rust bg-rust text-white"
        : "border-ink/40 text-ink/70";
  return (
    <span
      className={`inline-block border px-2 py-1 font-mono text-[12px] uppercase tracking-[0.2em] ${cls}`}
    >
      {status}
    </span>
  );
}
