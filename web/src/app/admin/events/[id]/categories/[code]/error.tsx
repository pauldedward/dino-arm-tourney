"use client";

import { useEffect } from "react";

export default function CategoryBracketError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface server-side error in browser console too.
    console.error("bracket page error", error);
  }, [error]);

  return (
    <div className="space-y-4 border-2 border-blood bg-paper p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-blood">
        Bracket failed to load
      </p>
      <pre className="whitespace-pre-wrap font-mono text-xs text-ink">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="border-2 border-ink bg-ink px-3 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-blood"
      >
        Retry
      </button>
    </div>
  );
}
