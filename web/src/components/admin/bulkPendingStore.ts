// Per-event localStorage cache for bulk-registration rows that failed to
// sync. Lets the operator close/refresh the tab without losing typed
// athletes — on the next mount the rows reappear in the right rail with
// status="error" so they can be retried.
//
// Scope decisions:
//  • Keyed by eventId so two events don't pollute each other.
//  • Only stores `"error"` rows. `"syncing"` is short-lived and a
//    persisted snapshot would race the in-flight POST (potential
//    duplicate). `"saved"` rows are already on the server.
//  • TTL of 7 days. Bulk reg desk is event-day software; anything older
//    than a week is almost certainly abandoned and a chest_no collision
//    risk if revived.
//  • Image previews live on the form Draft, not on SavedRow, so nothing
//    blob:-shaped needs stripping. The persisted row carries the
//    `photo_key` / `payment_proof_key` (storage paths) inside `payload`,
//    which is enough for a retry to attach the photo.

import type { SavedRow } from "./BulkRegistrationDesk";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function key(eventId: string) {
  return `bulk-pending:${eventId}`;
}

interface StoredEntry {
  row: SavedRow;
  // Wall-clock ms. Used to expire stale entries on read.
  stored_at: number;
}

function safeRead(eventId: string): StoredEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is StoredEntry =>
        e &&
        typeof e === "object" &&
        typeof e.stored_at === "number" &&
        e.row &&
        typeof e.row === "object"
    );
  } catch {
    return [];
  }
}

function safeWrite(eventId: string, entries: StoredEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(key(eventId));
    } else {
      window.localStorage.setItem(key(eventId), JSON.stringify(entries));
    }
  } catch {
    // Quota exceeded or storage disabled — silently drop. The row is
    // still in React state, so the operator can still retry while the
    // tab is open.
  }
}

/** Read non-expired errored rows for an event. Auto-evicts stale entries. */
export function loadPendingRows(eventId: string): SavedRow[] {
  const entries = safeRead(eventId);
  const now = Date.now();
  const fresh = entries.filter((e) => now - e.stored_at < TTL_MS);
  if (fresh.length !== entries.length) safeWrite(eventId, fresh);
  return fresh.map((e) => e.row);
}

/**
 * Replace the stored set for an event with the given errored rows.
 * Pass an empty array to clear. Idempotent.
 */
export function savePendingRows(eventId: string, rows: SavedRow[]): void {
  const now = Date.now();
  const entries: StoredEntry[] = rows.map((row) => ({ row, stored_at: now }));
  safeWrite(eventId, entries);
}
