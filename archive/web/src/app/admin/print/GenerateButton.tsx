"use client";

import { useState } from "react";

export default function GenerateButton({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/fixtures/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: eventId }),
    });
    const j = await res.json();
    setBusy(false);
    if (j.ok) setMsg(`Generated ${j.entries} entries across ${j.categories} categories (${j.fixtures} fixtures).`);
    else setMsg(`Error: ${j.error}`);
  }
  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood disabled:opacity-50"
      >
        {busy ? "Generating…" : "Generate / regenerate fixtures"}
      </button>
      {msg && <p className="mt-2 font-mono text-xs">{msg}</p>}
    </div>
  );
}
