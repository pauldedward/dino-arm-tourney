"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

export default function DeleteRegistrationButton({
  registrationId,
  label,
}: {
  registrationId: string;
  label: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onDelete() {
    const ok = await confirm({
      title: `Delete registration?`,
      message: `Delete registration for ${label}? This removes payments and bracket entries. Cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/registrations/${registrationId}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(json.error ?? "failed");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="border border-rust px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white disabled:opacity-40"
      >
        {busy ? "…" : "Delete"}
      </button>
      {err && <span className="font-mono text-[10px] text-rust">{err}</span>}
    </div>
  );
}
