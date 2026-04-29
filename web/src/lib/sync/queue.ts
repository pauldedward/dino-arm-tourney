"use client";

/**
 * Tiny IndexedDB-backed write queue for offline weigh-in captures.
 *
 * Schema: one store `queue` of { id, endpoint, method, parts, createdAt,
 * attempts, lastError }. Stores multipart `parts` explicitly because a
 * native FormData instance is not structured-cloneable — Blob entries
 * silently become null if stored raw.
 *
 * Consumers:
 *   - `enqueueWeighIn(formData)` — from the weigh-in detail page.
 *   - `flushQueue()` — called on online/focus/interval by SyncPill.
 *   - `subscribeQueue(cb)` — so the pill re-renders on add/remove.
 */

const DB_NAME = "dino-sync";
const STORE = "queue";

type Part =
  | { kind: "string"; name: string; value: string }
  | { kind: "blob"; name: string; blob: Blob; filename: string };

export interface Job {
  id?: number;
  endpoint: string;
  method: string;
  /** Multipart parts. Empty array when `body` is set (JSON path). */
  parts: Part[];
  /**
   * Optional JSON-encoded request body. When present, the flusher sends
   * `Content-Type: application/json` with this string as the body, instead
   * of building a FormData from `parts`. Older queued rows (pre-2026-04-29)
   * have no `body` field — they fall through to the FormData path.
   */
  body?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function fdToParts(fd: FormData): Promise<Part[]> {
  const parts: Part[] = [];
  for (const [name, value] of fd.entries()) {
    if (typeof value === "string") parts.push({ kind: "string", name, value });
    else parts.push({ kind: "blob", name, blob: value, filename: value.name || "blob" });
  }
  return parts;
}

function partsToFd(parts: Part[]): FormData {
  const fd = new FormData();
  for (const p of parts) {
    if (p.kind === "string") fd.set(p.name, p.value);
    else fd.set(p.name, p.blob, p.filename);
  }
  return fd;
}

async function add(
  endpoint: string,
  method: string,
  parts: Part[],
  body?: string,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const row: Omit<Job, "id"> = {
        endpoint,
        method,
        parts,
        createdAt: Date.now(),
        attempts: 0,
      };
      if (body !== undefined) row.body = body;
      tx.objectStore(STORE).add(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    // Most common: QuotaExceededError when a venue laptop has hoarded
    // weigh-in JPEGs and IDB hits the per-origin cap. Re-throw as a
    // typed error so the calling form can surface it instead of silently
    // dropping the user's data.
    const err = e as Error & { name?: string };
    if (err?.name === "QuotaExceededError" || /quota/i.test(err?.message ?? "")) {
      const wrapped = new Error(
        "Browser storage full \u2014 cannot queue this submission. Free up space and retry."
      ) as Error & { code?: string };
      wrapped.code = "QUEUE_QUOTA_EXCEEDED";
      throw wrapped;
    }
    throw e;
  }
  notify();
}

async function listAll(): Promise<Job[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Job[]);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify();
}

async function bump(job: Job, err: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...job, attempts: job.attempts + 1, lastError: err });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify();
}

export async function enqueueWeighIn(fd: FormData): Promise<void> {
  await add("/api/weighin", "POST", await fdToParts(fd));
}

/**
 * Queue a payment.verify (or .reject) action for a single payment row.
 * The matching server route is `/api/admin/payments/:id/:action` and takes
 * no body — `action` is in the URL.
 */
export async function enqueuePaymentAction(
  paymentId: string,
  action: "verify" | "reject"
): Promise<void> {
  await add(`/api/admin/payments/${paymentId}/${action}`, "POST", []);
}

/**
 * Queue an arbitrary JSON-bodied write (used for collect / adjust-total /
 * reverse, all of which take JSON payloads not multipart). Falls into the
 * same flush loop and same retry/drop policy as the multipart jobs.
 */
export async function enqueueJson(
  endpoint: string,
  method: string,
  body: unknown,
): Promise<void> {
  await add(endpoint, method, [], JSON.stringify(body ?? null));
}

export async function queueLength(): Promise<number> {
  try {
    return (await listAll()).length;
  } catch {
    return 0;
  }
}

let flushPromise: Promise<{ flushed: number; remaining: number; dropped: number }> | null = null;

// Status codes that should NOT be dropped as permanent client errors.
// 408 (timeout) and 429 (rate-limit) are inherently retryable. 401 means
// the operator's session expired mid-flush — dropping their queued
// verify/weighin would silently destroy desk work; keep retrying so the
// next page load that re-establishes auth flushes them.
const RETRYABLE_4XX = new Set([401, 408, 429]);

async function runFlush(): Promise<{
  flushed: number;
  remaining: number;
  dropped: number;
}> {
  let flushed = 0;
  let dropped = 0;
  const jobs = await listAll();
  for (const job of jobs) {
    try {
      const isJson = typeof job.body === "string";
      const init: RequestInit = {
        method: job.method,
        credentials: "include",
      };
      if (isJson) {
        init.body = job.body!;
        init.headers = { "Content-Type": "application/json" };
      } else {
        init.body = partsToFd(job.parts);
      }
      const res = await fetch(job.endpoint, init);
      if (res.ok) {
        await remove(job.id!);
        flushed++;
      } else if (
        res.status >= 400 &&
        res.status < 500 &&
        !RETRYABLE_4XX.has(res.status)
      ) {
        const text = await res.text().catch(() => "");
        await bump(job, `DROPPED HTTP ${res.status} ${text.slice(0, 120)}`);
        await remove(job.id!);
        dropped++;
      } else {
        const text = await res.text().catch(() => "");
        await bump(job, `HTTP ${res.status} ${text.slice(0, 120)}`);
      }
    } catch (e) {
      await bump(job, (e as Error).message);
    }
  }
  return { flushed, remaining: await queueLength(), dropped };
}

export async function flushQueue(): Promise<{
  flushed: number;
  remaining: number;
  dropped: number;
}> {
  if (flushPromise) return flushPromise;
  // Cross-tab single-flight: if another tab on this origin is also flushing,
  // wait for its lock. Without this, two tabs on the same desk laptop can
  // each pull the same job row and POST it twice. Web Locks API gives us
  // mutual exclusion across tabs. Falls back to in-memory lock if the API
  // is unavailable (older browsers, test environment).
  const useLocks = typeof navigator !== "undefined" && "locks" in navigator;
  flushPromise = (async () => {
    try {
      if (useLocks) {
        return await navigator.locks.request("dino-sync-flush", runFlush);
      }
      return await runFlush();
    } finally {
      flushPromise = null;
    }
  })();
  return flushPromise;
}

// Pub/sub so SyncPill can re-render without polling.
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
export function subscribeQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
