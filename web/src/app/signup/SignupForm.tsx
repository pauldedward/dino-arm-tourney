"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/db/supabase-browser";

export default function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Sign up failed");
      setBusy(false);
      return;
    }

    // Auto sign-in
    const supa = createClient();
    const { error: err } = await supa.auth.signInWithPassword({ email, password });
    if (err) {
      setError("Account created. Please sign in at /login.");
      setBusy(false);
      return;
    }
    router.push(next || "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <div className="border-2 border-ink bg-blood/10 p-3 font-mono text-xs">{error}</div>
      )}
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Full name</span>
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
          Password (min 8 chars)
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
          Confirm password
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create account →"}
      </button>
    </form>
  );
}
