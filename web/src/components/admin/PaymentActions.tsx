"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { enqueuePaymentAction, flushQueue } from "@/lib/sync/queue";
import { useConfirm } from "@/components/ConfirmDialog";

interface Props {
  paymentId: string;
  status: "pending" | "verified" | "rejected" | string;
  hasProof: boolean;
}

export default function PaymentActions({ paymentId, status, hasProof }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"verify" | "reject" | "view" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function viewProof() {
    setBusy("view");
    setErr(null);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/proof`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.error ?? "failed to load proof");
        return;
      }
      // Athlete may have uploaded multiple proofs (paid in instalments).
      // Open every one in a new tab so the operator can compare UTRs and
      // confirm the total before verifying.
      type HistEntry = { id: string; utr: string | null; url: string | null };
      const history: HistEntry[] = Array.isArray(json?.history) ? json.history : [];
      const urls = history.map((h) => h.url).filter((u): u is string => !!u);
      if (urls.length === 0 && json?.latest?.url) urls.push(json.latest.url);
      if (urls.length === 0) {
        setErr("no proof file");
        return;
      }
      urls.forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "verify" | "reject") {
    if (action === "reject" && !(await confirm({ message: "Reject this payment?", confirmLabel: "Reject", tone: "danger" }))) return;
    setBusy(action);
    setErr(null);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const res = await fetch(`/api/admin/payments/${paymentId}/${action}`, {
          method: "POST",
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          if (json?.alreadyResolved) {
            // Another desk got there first. Show it so the operator
            // doesn't think their click did the work.
            setErr("already resolved by another desk");
          }
          router.refresh();
          setBusy(null);
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          setErr(json.error ?? "failed");
          setBusy(null);
          return;
        }
      } catch {
        // fall through to queue
      }
    }

    try {
      await enqueuePaymentAction(paymentId, action);
    } catch (e) {
      setErr((e as Error).message ?? "could not queue offline");
      setBusy(null);
      return;
    }
    setErr(action === "verify" ? "queued · will sync" : "queued");
    setBusy(null);
    flushQueue();
    router.refresh();
  }

  const canDecide = status === "pending" && hasProof;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {hasProof && (
        <button
          type="button"
          onClick={viewProof}
          disabled={!!busy}
          className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink hover:bg-kraft/30 disabled:opacity-40"
        >
          {busy === "view" ? "…" : "View proof"}
        </button>
      )}
      {canDecide && (
        <>
          <button
            type="button"
            onClick={() => act("verify")}
            disabled={!!busy}
            className="border border-moss bg-moss px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white disabled:opacity-40"
          >
            {busy === "verify" ? "…" : "Verify"}
          </button>
          <button
            type="button"
            onClick={() => act("reject")}
            disabled={!!busy}
            className="border border-rust px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust disabled:opacity-40"
          >
            {busy === "reject" ? "…" : "Reject"}
          </button>
        </>
      )}
      {err && <span className="font-mono text-[10px] text-rust">{err}</span>}
    </div>
  );
}

