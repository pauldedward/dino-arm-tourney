"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLES = ["operator", "super_admin", "athlete"] as const;

export default function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("operator");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/users/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, role }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error ?? "invite failed");
      return;
    }
    setMsg(`Invited ${email}.`);
    setEmail("");
    setFullName("");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 border-2 border-ink p-4"
    >
      <div className="flex-1 min-w-[200px]">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
      </div>
      <div className="flex-1 min-w-[200px]">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Full name</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
      </div>
      <div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="h-10 border-2 border-ink bg-ink px-5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust disabled:opacity-40"
      >
        {busy ? "Inviting…" : "Send invite →"}
      </button>
      {msg && <span className="font-mono text-xs text-ink/70">{msg}</span>}
    </form>
  );
}
