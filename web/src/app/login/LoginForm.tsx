"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/db/supabase-browser";

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
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supa = createClient();
    const { data: signIn, error: err } = await supa.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    let dest = next && next.startsWith("/") ? next : "/";
    if (!next && signIn.user) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", signIn.user.id)
        .maybeSingle();
      if (profile?.role === "operator" || profile?.role === "super_admin") {
        dest = "/admin";
      }
    }
    router.push(dest);
    router.refresh();
  }

  async function sendReset() {
    setResetMsg(null);
    setError(null);
    if (!email) {
      setError("Enter your email above first, then tap the reset link.");
      return;
    }
    setResetBusy(true);
    const supa = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      "/account/set-password"
    )}`;
    const { error: err } = await supa.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    setResetBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setResetMsg(
      "Email sent. Open the link on this device to set your password."
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <div className="border-2 border-ink bg-rust/10 p-3 font-mono text-xs">{error}</div>
      )}
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-kraft/30 focus:outline-none"
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
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-kraft/30 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone disabled:opacity-50"
      >
        {busy ? "Signing in\u2026" : "Sign in \u2192"}
      </button>      {resetMsg && (
        <div className="border-2 border-ink bg-volt/30 p-3 font-mono text-xs">
          {resetMsg}
        </div>
      )}
      <p className="font-mono text-[11px] text-ink/60">
        Invited by an admin or forgot your password?{" "}
        <button
          type="button"
          onClick={sendReset}
          disabled={resetBusy}
          className="underline decoration-blood decoration-2 underline-offset-4 hover:text-blood disabled:opacity-50"
        >
          {resetBusy ? "Sending…" : "Email me a set-password link →"}
        </button>
      </p>    </form>
  );
}
