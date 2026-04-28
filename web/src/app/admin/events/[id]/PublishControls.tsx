"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

interface Props {
  eventId: string;
  status: string;
  registrationPublishedAt: string | null;
  registrationClosedAt: string | null;
}

export default function PublishControls({
  eventId,
  status,
  registrationPublishedAt,
  registrationClosedAt,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const opensAt = registrationPublishedAt ? new Date(registrationPublishedAt).getTime() : null;
  const closesAt = registrationClosedAt ? new Date(registrationClosedAt).getTime() : null;
  const regOpen = opensAt !== null && opensAt <= now && (closesAt === null || closesAt > now);

  async function act(action: "publish" | "close_registrations" | "reopen" | "archive", confirmMsg?: string) {
    if (confirmMsg && !(await confirm({ message: confirmMsg, tone: "warn" }))) return;
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/admin/events/${eventId}/${action}`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "failed");
      setBusy(null);
      return;
    }
    router.refresh();
    setBusy(null);
  }

  return (
    <div className="border-2 border-ink p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        Lifecycle
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {status === "draft" && (
          <Big onClick={() => act("publish", "Publish this event and open registrations now?")} disabled={!!busy} color="rust">
            {busy === "publish" ? "Publishing…" : "Publish & open registrations →"}
          </Big>
        )}
        {status !== "draft" && regOpen && (
          <Big onClick={() => act("close_registrations", "Close registrations now?")} disabled={!!busy}>
            {busy === "close_registrations" ? "Closing…" : "Close registrations"}
          </Big>
        )}
        {status !== "draft" && !regOpen && status !== "archived" && (
          <Big onClick={() => act("reopen", "Re-open registrations?")} disabled={!!busy} color="rust">
            {busy === "reopen" ? "Re-opening…" : "Re-open registrations"}
          </Big>
        )}
        {status !== "archived" && status !== "draft" && (
          <Big onClick={() => act("archive", "Archive this event? Hides it from public and landing page.")} disabled={!!busy} variant="ghost">
            {busy === "archive" ? "Archiving…" : "Archive"}
          </Big>
        )}
      </div>
      {error && (
        <p className="mt-3 font-mono text-xs text-rust">{error}</p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-4 font-mono text-[11px] text-ink/70">
        <div>
          <dt className="uppercase tracking-[0.2em] text-ink/40">Opened at</dt>
          <dd>{registrationPublishedAt ? new Date(registrationPublishedAt).toLocaleString("en-IN") : "—"}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.2em] text-ink/40">Closed at</dt>
          <dd>{registrationClosedAt ? new Date(registrationClosedAt).toLocaleString("en-IN") : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

function Big({
  onClick,
  disabled,
  color = "ink",
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  color?: "ink" | "rust";
  variant?: "ghost";
  children: React.ReactNode;
}) {
  const base = "px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] border-2 disabled:opacity-40";
  const cls =
    variant === "ghost"
      ? `${base} border-ink/30 text-ink/70 hover:border-ink hover:text-ink`
      : color === "rust"
        ? `${base} border-rust bg-rust text-bone hover:bg-ink hover:border-ink`
        : `${base} border-ink bg-ink text-bone hover:bg-rust hover:border-rust`;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
