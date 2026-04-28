"use client";

/**
 * Global pretty confirm dialog.
 *
 * Replaces window.confirm() across the app.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: "Delete this row?" }))) return;
 *
 * Mounted once via <ConfirmProvider> in the root layout.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ConfirmTone = "default" | "danger" | "warn";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    // SSR / un-provided: safe fallback so callers never crash.
    return async (opts) =>
      typeof window !== "undefined" ? window.confirm(opts.message) : false;
  }
  return fn;
}

interface PendingState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      setPending((cur) => {
        if (cur) cur.resolve(value);
        return null;
      });
    },
    []
  );

  // Esc cancels, Enter confirms.
  useEffect(() => {
    if (!pending) return;
    previouslyFocused.current =
      (typeof document !== "undefined" && (document.activeElement as HTMLElement)) || null;
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 30);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    }
    window.addEventListener("keydown", onKey);
    // Lock scroll while modal open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmModal
          opts={pending}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
          confirmBtnRef={confirmBtnRef}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  opts,
  onCancel,
  onConfirm,
  confirmBtnRef,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
  confirmBtnRef: React.MutableRefObject<HTMLButtonElement | null>;
}) {
  const tone: ConfirmTone = opts.tone ?? inferTone(opts);
  const title = opts.title ?? defaultTitle(tone);
  const confirmLabel = opts.confirmLabel ?? (tone === "danger" ? "Delete" : "Confirm");
  const cancelLabel = opts.cancelLabel ?? "Cancel";

  const accent =
    tone === "danger"
      ? "bg-rust text-white border-rust hover:bg-ink hover:border-ink"
      : tone === "warn"
        ? "bg-gold text-ink border-gold hover:bg-ink hover:text-gold hover:border-ink"
        : "bg-ink text-bone border-ink hover:bg-rust hover:border-rust";

  const ribbon =
    tone === "danger" ? "bg-rust" : tone === "warn" ? "bg-gold" : "bg-ink";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm animate-[confirmFade_120ms_ease-out]"
      />

      {/* card */}
      <div
        className="relative w-full max-w-md border-2 border-ink bg-bone shadow-[8px_8px_0_0_rgba(10,27,20,1)] animate-[confirmPop_160ms_cubic-bezier(.2,.7,.3,1.2)]"
      >
        {/* ribbon */}
        <div className={`h-2 w-full ${ribbon}`} />

        <div className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
            {tone === "danger" ? "Destructive action" : tone === "warn" ? "Heads up" : "Please confirm"}
          </p>
          <h2
            id="confirm-title"
            className="mt-2 font-display text-2xl font-semibold leading-tight text-ink"
          >
            {title}
          </h2>
          <p
            id="confirm-message"
            className="mt-3 text-sm leading-relaxed text-ink/80"
          >
            {opts.message}
          </p>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="border-2 border-ink/30 bg-transparent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink/70 hover:border-ink hover:text-ink"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              ref={confirmBtnRef}
              onClick={onConfirm}
              className={`border-2 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${accent}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes confirmFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes confirmPop {
          0%   { opacity: 0; transform: translateY(8px) scale(.96); }
          100% { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
}

function inferTone(opts: ConfirmOptions): ConfirmTone {
  const s = `${opts.title ?? ""} ${opts.message}`.toLowerCase();
  if (/\b(delete|remove|disable|reject|cannot be undone|destroy|drop)\b/.test(s)) return "danger";
  if (/\b(replace|regenerate|overwrite|close|reopen|promote)\b/.test(s)) return "warn";
  return "default";
}

function defaultTitle(tone: ConfirmTone): string {
  if (tone === "danger") return "Are you sure?";
  if (tone === "warn") return "Confirm change";
  return "Confirm";
}
