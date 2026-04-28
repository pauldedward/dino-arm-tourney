"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

export default function GenerateButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    const ok = await confirm({
      title: "Regenerate fixtures?",
      message: "Existing brackets will be replaced.",
      confirmLabel: "Regenerate",
      tone: "warn",
    });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/fixtures/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: eventId }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? "failed");
      return;
    }
    setMsg(
      `Generated: ${j.categories} categories · ${j.entries} entries · ${j.fixtures} matches`
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust disabled:opacity-40"
      >
        {busy ? "Generating…" : "Generate fixtures →"}
      </button>
      {msg && (
        <span className="font-mono text-[10px] text-ink/70">{msg}</span>
      )}
    </div>
  );
}
