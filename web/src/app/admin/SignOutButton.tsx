"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/db/supabase-browser";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-bone hover:bg-rust hover:border-rust disabled:opacity-50"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
