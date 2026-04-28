"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = [
  "operator",
  "weigh_in_official",
  "organiser",
  "federation_admin",
  "super_admin",
  "referee",
  "medical",
  "accounts",
];

export default function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("operator");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, full_name: name, role }),
    });
    const j = await res.json();
    setBusy(false);
    if (j.ok) {
      setMsg(`Invited ${email}. Temporary password: ${j.tempPassword}`);
      setEmail("");
      setName("");
      router.refresh();
    } else {
      setMsg(`Error: ${j.error}`);
    }
  }

  return (
    <form onSubmit={submit} className="border-2 border-ink p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">Invite user</p>
      <div className="flex flex-wrap items-end gap-3">
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="border-2 border-ink bg-bone px-3 py-2 font-mono text-sm focus:bg-volt focus:outline-none"
        />
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="border-2 border-ink bg-bone px-3 py-2 font-mono text-sm focus:bg-volt focus:outline-none"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          disabled={busy}
          className="border-2 border-ink bg-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood disabled:opacity-50"
        >
          {busy ? "…" : "Invite"}
        </button>
      </div>
      {msg && <p className="mt-3 font-mono text-xs">{msg}</p>}
    </form>
  );
}
