"use client";

import { useState } from "react";

export default function DeleteEventForm({
  action,
  eventName,
  regCount,
}: {
  action: (formData: FormData) => Promise<void>;
  eventName: string;
  regCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const blocked = regCount > 0;
  const canDelete = !blocked && confirm === eventName;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={blocked ? "Archive instead — registrations exist" : ""}
        className="mt-3 border-2 border-blood bg-bone px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-blood hover:bg-blood hover:text-bone disabled:cursor-not-allowed disabled:opacity-50"
      >
        Delete event…
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3">
      <p className="font-mono text-xs">
        To confirm, type the event name exactly:{" "}
        <span className="font-bold">{eventName}</span>
      </p>
      <input
        name="confirm_name"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoFocus
        className="w-full max-w-md border-2 border-blood bg-bone px-3 py-2 font-mono text-sm focus:bg-volt focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canDelete}
          className="border-2 border-blood bg-blood px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone disabled:opacity-40"
        >
          Delete permanently
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirm(""); }}
          className="border-2 border-ink bg-bone px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
