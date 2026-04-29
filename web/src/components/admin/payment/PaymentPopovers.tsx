"use client";

/**
 * Shared payment-action popovers used by both the operator-side
 * registrations table (FastRegistrationsTable) and the counter desk
 * sidebar (BulkRegistrationDesk). Pure UI — every action is dispatched
 * to a parent-supplied `onConfirm`. The parent owns endpoint calls,
 * audit-log hand-off, and offline-queue fallback.
 *
 * Each popover is a fixed full-screen scrim; close behaviour is the
 * standard click-on-backdrop / Cancel button.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// CollectPopover
// ---------------------------------------------------------------------------

export type CollectTarget =
  | { kind: "single"; paymentId: string; amount: number; label: string }
  | {
      kind: "bulk";
      paymentIds: string[];
      total: number;
      label: string;
      defaultPayer: string | null;
    };

export interface CollectConfirm {
  method: "cash" | "manual_upi" | "waiver";
  reference: string | null;
  amountOverride: number | null;
  waiveRemainder: boolean;
  /** Bulk only — pool to spread oldest-first. null = "settle each remainder". */
  poolAmount: number | null;
  /** Bulk only — stamped on every created collection. */
  payerLabel: string | null;
}

export function CollectPopover({
  target,
  onClose,
  onConfirm,
}: {
  target: CollectTarget;
  onClose: () => void;
  onConfirm: (opts: CollectConfirm) => void;
}) {
  const [method, setMethod] = useState<"cash" | "manual_upi" | "waiver">("cash");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(
    target.kind === "single" ? String(target.amount) : ""
  );
  const [waiveRemainder, setWaiveRemainder] = useState(false);
  const [poolAmount, setPoolAmount] = useState(
    target.kind === "bulk" ? String(target.total) : ""
  );
  const [payerLabel, setPayerLabel] = useState(
    target.kind === "bulk" ? target.defaultPayer ?? "" : ""
  );
  const total = target.kind === "single" ? target.amount : target.total;
  const typed = Number(amount) || 0;
  const willWaiveAmount =
    target.kind === "single" && waiveRemainder ? Math.max(0, total - typed) : 0;
  const poolNum = Number(poolAmount) || 0;
  const poolShortfall =
    target.kind === "bulk" && method !== "waiver"
      ? Math.max(0, total - poolNum)
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          {target.kind === "single" ? "Mark as collected" : "Bulk collect"}
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          Remaining balance{" "}
          <span className="font-bold text-ink">
            ₹{total.toLocaleString("en-IN")}
          </span>
          {target.kind === "bulk"
            ? " · type a smaller pool to auto-allocate oldest-first"
            : " · type a smaller amount for an installment"}
        </p>

        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Method
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-1 border-2 border-ink">
              {(
                [
                  ["cash", "Cash"],
                  ["manual_upi", "UPI"],
                  ["waiver", "Waiver"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMethod(v)}
                  className={`px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                    method === v ? "bg-ink text-bone" : "bg-bone text-ink hover:bg-kraft/30"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>

          {target.kind === "single" && method !== "waiver" && (
            <label className="block">
              <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                Amount (₹)
              </span>
              <input
                type="number"
                min={0}
                max={total}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block font-mono text-[12px] text-ink/50">
                Defaults to the full remainder. Type a smaller number to
                record an installment — the next collect will offer the
                rest.
              </span>
            </label>
          )}

          {target.kind === "single" && method !== "waiver" && total - typed > 0 && (
            <label className="flex items-start gap-2 border-2 border-dashed border-ink/30 bg-kraft/10 px-3 py-2">
              <input
                type="checkbox"
                checked={waiveRemainder}
                onChange={(e) => setWaiveRemainder(e.target.checked)}
                className="mt-0.5"
              />
              <span className="font-mono text-[13px] leading-snug text-ink/80">
                Waive the rest (₹{Math.max(0, total - typed).toLocaleString("en-IN")})
                <span className="block text-[12px] text-ink/50">
                  Closes the balance with a waiver collection so the
                  athlete shows as fully paid.
                </span>
              </span>
            </label>
          )}

          {target.kind === "bulk" && method !== "waiver" && (
            <>
              <label className="block">
                <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                  Pool amount (₹)
                </span>
                <input
                  type="number"
                  min={0}
                  value={poolAmount}
                  onChange={(e) => setPoolAmount(e.target.value)}
                  className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
                />
                <span className="mt-1 block font-mono text-[12px] text-ink/50">
                  Defaults to the full district balance. Lower it and we
                  auto-allocate oldest-first until it runs out.
                </span>
              </label>
              {poolShortfall > 0 && (
                <p className="border-2 border-gold bg-gold/10 px-3 py-2 font-mono text-[13px] leading-snug text-ink">
                  ⚠ Pool ₹{poolNum.toLocaleString("en-IN")} is short by ₹
                  {poolShortfall.toLocaleString("en-IN")}. Athletes are
                  settled oldest-first; the rest stay pending.
                </p>
              )}
              <label className="block">
                <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                  Paid by
                </span>
                <input
                  type="text"
                  value={payerLabel}
                  onChange={(e) => setPayerLabel(e.target.value)}
                  placeholder="District or team name"
                  className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
                />
                <span className="mt-1 block font-mono text-[12px] text-ink/50">
                  Stamped on every collection so the row shows a small
                  &quot;By {payerLabel || "…"}&quot; chip.
                </span>
              </label>
              <label className="flex items-start gap-2 border-2 border-dashed border-ink/30 bg-kraft/10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={waiveRemainder}
                  onChange={(e) => setWaiveRemainder(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="font-mono text-[13px] leading-snug text-ink/80">
                  Treat any shortfall as a waiver per athlete.
                </span>
              </label>
            </>
          )}

          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reference / note
            </span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                target.kind === "bulk"
                  ? "e.g. Trichy DC · Mr. Selvam · 22-Apr · receipt #421"
                  : "e.g. cash receipt #018"
              }
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
            {target.kind === "bulk" && (
              <span className="mt-1 block font-mono text-[12px] text-ink/50">
                Same reference is recorded on every payment so you can
                find the bundle later in the audit log.
              </span>
            )}
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                method,
                reference: reference.trim() || null,
                amountOverride:
                  target.kind === "single" && method !== "waiver" && amount.trim().length > 0
                    ? Math.max(0, Number(amount) || 0)
                    : null,
                waiveRemainder,
                poolAmount:
                  target.kind === "bulk" && method !== "waiver" && poolAmount.trim().length > 0
                    ? Math.max(0, Number(poolAmount) || 0)
                    : null,
                payerLabel:
                  target.kind === "bulk" && payerLabel.trim().length > 0
                    ? payerLabel.trim()
                    : null,
              })
            }
            className="border-2 border-ink bg-ink px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust"
          >
            {method === "waiver"
              ? `Waive ₹${total.toLocaleString("en-IN")}`
              : waiveRemainder && willWaiveAmount > 0
                ? `Collect ₹${typed.toLocaleString("en-IN")} + waive ₹${willWaiveAmount.toLocaleString("en-IN")}`
                : target.kind === "bulk" && poolNum > 0 && poolNum < total
                  ? `Allocate ₹${poolNum.toLocaleString("en-IN")} oldest-first`
                  : `Confirm collect`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdjustTotalPopover
// ---------------------------------------------------------------------------

export interface AdjustTarget {
  paymentId: string;
  currentTotal: number;
  collected: number;
  label: string;
}

export function AdjustTotalPopover({
  target,
  onClose,
  onConfirm,
}: {
  target: AdjustTarget;
  onClose: () => void;
  onConfirm: (opts: { amountInr: number; reason: string | null }) => void;
}) {
  const [amount, setAmount] = useState(String(target.currentTotal));
  const [reason, setReason] = useState("");
  const newTotal = Math.max(0, Number(amount) || 0);
  const newRemaining = Math.max(0, newTotal - target.collected);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          Adjust total fee
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          ₹{target.collected.toLocaleString("en-IN")} already collected.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              New total (₹)
            </span>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block font-mono text-[12px] text-ink/50">
              {newTotal === target.collected
                ? "Will mark as fully paid."
                : newTotal > target.collected
                  ? `Will leave ₹${newRemaining.toLocaleString("en-IN")} pending.`
                  : "New total is below collected — refund flow not implemented; will still mark as fully paid."}
            </span>
          </label>
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. extra category added, fee correction"
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({ amountInr: newTotal, reason: reason.trim() || null })
            }
            className="border-2 border-ink bg-ink px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust"
          >
            Save total
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UndoCollectPopover
// ---------------------------------------------------------------------------

export interface UndoTarget {
  paymentId: string;
  collected: number;
  label: string;
}

export function UndoCollectPopover({
  target,
  onClose,
  onConfirm,
}: {
  target: UndoTarget;
  onClose: () => void;
  onConfirm: (opts: { reason: string; all: boolean }) => void;
}) {
  const [reason, setReason] = useState("");
  const [all, setAll] = useState(false);
  const ok = reason.trim().length >= 3;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-rust">
          Undo collection
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          Soft-reverses {all ? "all collections" : "the most recent collection"}.
          The row stays in the audit log.
        </p>

        <div className="mt-5 space-y-4">
          <label className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.2em] text-ink/80">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Reverse every active collection
          </label>
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reason (required)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong athlete, double-counted, accidental verify"
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onConfirm({ reason: reason.trim(), all })}
            className="border-2 border-rust bg-rust px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reverse
          </button>
        </div>
      </div>
    </div>
  );
}
