"use client";

/**
 * Tiny IndexedDB-backed write queue for offline weigh-in / payment-verify.
 * Single store: { id (auto), endpoint, method, formDataParts, createdAt }.
 * formDataParts is a serialised array because FormData itself is not structured-cloneable
 * (Blob entries become null when stored directly as a FormData object).
 */

const DB_NAME = "dino-sync";
const STORE = "queue";

type Part =
  | { kind: "string"; name: string; value: string }
  | { kind: "blob"; name: string; blob: Blob; filename: string };

type Job = {
  id?: number;
  endpoint: string;
  method: string;
  parts: Part[];
  createdAt: number;
  attempts: number;
};

function open(): Promise<IDBDatabase> {
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

async function add(job: Omit<Job, "id" | "createdAt" | "attempts">): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...job, createdAt: Date.now(), attempts: 0 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify();
}

async function listAll(): Promise<Job[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Job[]);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id: number): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify();
}

async function bumpAttempts(job: Job): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...job, attempts: job.attempts + 1 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueWeighIn(fd: FormData): Promise<void> {
  await add({ endpoint: "/api/weighin", method: "POST", parts: await fdToParts(fd) });
}

export async function enqueuePaymentVerify(payment_id: string): Promise<void> {
  const fd = new FormData();
  fd.set("payment_id", payment_id);
  await add({ endpoint: "/api/payment/verify", method: "POST", parts: await fdToParts(fd) });
}

let flushing = false;

export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: (await listAll()).length };
  flushing = true;
  let flushed = 0;
  try {
    const jobs = await listAll();
    for (const job of jobs) {
      try {
        let res: Response;
        if (job.endpoint === "/api/payment/verify") {
          const idPart = job.parts.find((p) => p.kind === "string" && p.name === "payment_id");
          const payment_id = idPart && idPart.kind === "string" ? idPart.value : "";
          res = await fetch(job.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payment_id }),
          });
        } else {
          res = await fetch(job.endpoint, { method: job.method, body: partsToFd(job.parts) });
        }
        if (res.ok) {
          await remove(job.id!);
          flushed++;
        } else {
          await bumpAttempts(job);
        }
      } catch {
        await bumpAttempts(job);
      }
    }
  } finally {
    flushing = false;
  }
  const remaining = (await listAll()).length;
  return { flushed, remaining };
}

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
export function subscribeQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function queueLength(): Promise<number> {
  return (await listAll()).length;
}
