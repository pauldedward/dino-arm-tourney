"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supa = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error: err } = await supa.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    router.push(next || "/admin");
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
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in →"}
      </button>
    </form>
  );
}
