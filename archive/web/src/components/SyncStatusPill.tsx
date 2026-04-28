"use client";

import { useEffect, useState } from "react";
import { flushQueue, queueLength, subscribeQueue } from "@/lib/sync/queue";

export default function SyncStatusPill() {
  const [n, setN] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = async () => setN(await queueLength());
    refresh();
    const unsub = subscribeQueue(refresh);
    const tick = setInterval(async () => {
      if (navigator.onLine) await flushQueue();
      await refresh();
    }, 15000);
    const onOnline = async () => {
      setOnline(true);
      await flushQueue();
      await refresh();
    };
    const onOffline = () => setOnline(false);
    const onFocus = async () => {
      if (navigator.onLine) await flushQueue();
      await refresh();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      clearInterval(tick);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!online) {
    return (
      <span className="border border-blood bg-blood px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-bone">
        Offline · {n} queued
      </span>
    );
  }
  if (n > 0) {
    return (
      <span className="border border-volt bg-volt px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink">
        Syncing {n}…
      </span>
    );
  }
  return (
    <span className="border border-bone/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/70">
      All synced
    </span>
  );
}
