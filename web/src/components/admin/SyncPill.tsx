"use client";

import { useEffect, useState } from "react";
import {
  flushQueue,
  queueLength,
  subscribeQueue,
} from "@/lib/sync/queue";

/**
 * Header status pill. Shows "All synced" when empty; "N pending"
 * (rust color) when jobs are queued. Flushes on mount, online, focus,
 * and every 15s while the tab is active.
 */
export default function SyncPill() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const n = await queueLength();
      if (!cancelled) setPending(n);
    }

    async function flush() {
      if (!navigator.onLine) return;
      setBusy(true);
      await flushQueue();
      setBusy(false);
      refresh();
    }

    setOnline(navigator.onLine);
    refresh();
    flush();

    const unsub = subscribeQueue(refresh);

    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    const onFocus = () => flush();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(flush, 15000);

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, []);

  if (pending === 0 && online) {
    return (
      <span className="inline-flex items-center gap-2 border border-moss/30 bg-moss/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
        <span className="h-1.5 w-1.5 rounded-full bg-moss" /> synced
      </span>
    );
  }

  const label =
    pending === 0
      ? "offline"
      : `${pending} pending${busy ? " · syncing" : online ? " · retrying" : ""}`;

  return (
    <span
      className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${
        pending === 0
          ? "border-ink/40 text-ink/60"
          : "border-rust bg-rust/10 text-rust"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          pending === 0 ? "bg-ink/50" : "bg-rust"
        } ${busy ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  );
}
