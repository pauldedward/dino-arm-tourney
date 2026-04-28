"use client";

import { useRef, useState } from "react";

type Status = "pending" | "submitted" | "verified" | "rejected";

export default function PaymentProofForm({
  paymentId,
  initialUtr,
  initialStatus,
}: {
  paymentId: string;
  initialUtr: string;
  initialStatus: Status;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [utr, setUtr] = useState(initialUtr);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!utr.trim()) {
      setError("UTR / Transaction ID is required");
      return;
    }
    if (!fileRef.current?.files?.[0]) {
      setError("Please attach a screenshot of the payment");
      return;
    }
    const form = new FormData();
    form.set("payment_id", paymentId);
    form.set("utr", utr.trim());
    form.set("screenshot", fileRef.current.files[0]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/payment/proof", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Submission failed");
        setSubmitting(false);
        return;
      }
      setStatus("submitted");
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  if (status === "submitted") {
    return (
      <div className="mt-4 border-2 border-ink bg-volt p-4 font-mono text-sm">
        Proof submitted. Operator will verify shortly.
      </div>
    );
  }
  if (status === "verified") {
    return (
      <div className="mt-4 border-2 border-ink bg-volt p-4 font-mono text-sm">
        Verified. See you at weigh-in.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      {error && (
        <div className="border-2 border-ink bg-blood/10 p-3 font-mono text-sm">{error}</div>
      )}
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
          UTR / Transaction ID
        </span>
        <input
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          placeholder="412345678901"
          className="tnum mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
          Screenshot of payment success
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          required
          className="mt-2 block w-full font-mono text-xs"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit payment proof"}
      </button>
    </form>
  );
}
