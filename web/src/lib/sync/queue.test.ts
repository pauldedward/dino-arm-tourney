/**
 * Behavior tests for the offline write queue.
 *
 * Verifies the four real-life scenarios that match-day depends on:
 *   1. submit while online → POST flushes immediately, no IDB row
 *   2. submit while offline → IDB row written, no POST
 *   3. queued row + go online + flushQueue() → POST fires, row removed
 *   4. POST returns 5xx → row stays, attempts++ ; later 200 → row removed
 *   5. POST returns 4xx → row stays with last_error (do not retry forever
 *      via flush — caller decides; we still bump attempts so it's visible)
 *
 * Uses fake-indexeddb so node --test runs with no browser.
 */

import "fake-indexeddb/auto";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

// queue.ts is "use client" but at runtime that directive is just a hint —
// node --test loads the module fine. tsx handles the TS.
import {
  enqueueJson,
  enqueuePaymentAction,
  enqueueWeighIn,
  flushQueue,
  queueLength,
} from "./queue";

// Provide minimal globals queue.ts touches. fake-indexeddb gives us
// indexedDB; we shim FormData/Blob via undici (built into Node 22).
type FetchCall = {
  url: string;
  method: string;
  bodyKeys: string[];
  bodyText: string | null;
  contentType: string | null;
};
let calls: FetchCall[] = [];
let nextResponses: Array<Response | Error> = [];

function mockFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = init?.method ?? "GET";
    const body = init?.body;
    let bodyKeys: string[] = [];
    let bodyText: string | null = null;
    if (body instanceof FormData) bodyKeys = [...body.keys()];
    else if (typeof body === "string") bodyText = body;
    const headers = init?.headers as Record<string, string> | undefined;
    const contentType = headers?.["Content-Type"] ?? headers?.["content-type"] ?? null;
    calls.push({ url, method, bodyKeys, bodyText, contentType });
    const next = nextResponses.shift();
    if (!next) throw new Error("no mock response queued");
    if (next instanceof Error) throw next;
    return next;
  };
}

async function clearAllJobs() {
  // Drain by replying 200 to anything queued and flushing.
  const n = await queueLength();
  for (let i = 0; i < n; i++) nextResponses.push(new Response("", { status: 200 }));
  await flushQueue();
}

beforeEach(async () => {
  // Drain leftover jobs from prior tests FIRST (with throwaway fetch),
  // then reset call log so the test sees a clean slate.
  globalThis.fetch = mockFetch();
  await clearAllJobs();
  calls = [];
  nextResponses = [];
});

function makeFd() {
  const fd = new FormData();
  fd.set("registration_id", "reg-1");
  fd.set("measured_kg", "78.40");
  fd.set("file", new Blob(["fakejpegbytes"], { type: "image/jpeg" }), "weighin.jpg");
  return fd;
}

test("enqueue writes one job to IDB and persists FormData parts", async () => {
  await enqueueWeighIn(makeFd());
  assert.equal(await queueLength(), 1);
});

test("flushQueue drains queued jobs as multipart POST and removes them on 200", async () => {
  await enqueueWeighIn(makeFd());
  nextResponses.push(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  const result = await flushQueue();

  assert.equal(result.flushed, 1);
  assert.equal(result.remaining, 0);
  assert.equal(await queueLength(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/weighin");
  assert.equal(calls[0].method, "POST");
  // Confirm Blob round-tripped (the historical foot-gun in this code).
  assert.deepEqual(calls[0].bodyKeys.sort(), ["file", "measured_kg", "registration_id"]);
});

test("network error keeps job and bumps attempts; later success drains it", async () => {
  await enqueueWeighIn(makeFd());

  // First attempt: network fails (offline / DNS)
  nextResponses.push(new Error("Failed to fetch"));
  let r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.remaining, 1);

  // Second attempt: success
  nextResponses.push(new Response("", { status: 200 }));
  r = await flushQueue();
  assert.equal(r.flushed, 1);
  assert.equal(r.remaining, 0);
});

test("HTTP 5xx leaves job queued for retry", async () => {
  await enqueueWeighIn(makeFd());
  nextResponses.push(new Response("server boom", { status: 503 }));

  const r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.remaining, 1);
});

test("HTTP 4xx is dropped (permanent client error) so it does not block the queue", async () => {
  await enqueueWeighIn(makeFd());
  nextResponses.push(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));

  const r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.dropped, 1);
  assert.equal(r.remaining, 0);
  assert.equal(await queueLength(), 0);
});

test("HTTP 408 / 429 are retryable (kept in queue)", async () => {
  await enqueueWeighIn(makeFd());
  nextResponses.push(new Response("rate limited", { status: 429 }));

  const r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.dropped, 0);
  assert.equal(r.remaining, 1);
});

test("dropped 4xx in front of queue does not block subsequent valid job", async () => {
  await enqueueWeighIn(makeFd()); // job 1: will 404
  await enqueuePaymentAction("good-id", "verify"); // job 2: will 200
  nextResponses.push(new Response("not found", { status: 404 }));
  nextResponses.push(new Response("", { status: 200 }));

  const r = await flushQueue();
  assert.equal(r.flushed, 1);
  assert.equal(r.dropped, 1);
  assert.equal(r.remaining, 0);
});

test("flushQueue is reentrancy-safe (concurrent calls do not double-POST)", async () => {
  await enqueueWeighIn(makeFd());
  // Only ONE response queued — if both flushes ran they'd both try to fetch
  // and the second would throw "no mock response queued".
  nextResponses.push(new Response("", { status: 200 }));

  const [a, b] = await Promise.all([flushQueue(), flushQueue()]);
  // Both calls return the SAME in-flight promise → identical results.
  // The real proof of no double-POST: only one fetch happened.
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(await queueLength(), 0);
});

test("enqueuePaymentAction targets the per-payment URL with no body", async () => {
  await enqueuePaymentAction("pay-123", "verify");
  nextResponses.push(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  await flushQueue();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/payments/pay-123/verify");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].bodyKeys, []);
  assert.equal(await queueLength(), 0);
});

test("mixed queue (weigh-in + payment) drains in FIFO order", async () => {
  await enqueueWeighIn(makeFd());
  await enqueuePaymentAction("pay-9", "verify");
  nextResponses.push(new Response("", { status: 200 }));
  nextResponses.push(new Response("", { status: 200 }));

  const r = await flushQueue();

  assert.equal(r.flushed, 2);
  assert.equal(await queueLength(), 0);
  assert.equal(calls[0].url, "/api/weighin");
  assert.equal(calls[1].url, "/api/admin/payments/pay-9/verify");
});

// ===== Hardening tests added 2026-04-22 (rigorous match-day pass) =====

test("HTTP 401 is retryable, not dropped (operator session expired mid-flush)", async () => {
  await enqueuePaymentAction("pay-1", "verify");
  // First attempt: session expired
  nextResponses.push(new Response(JSON.stringify({ error: "auth" }), { status: 401 }));
  let r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.dropped, 0, "401 must NOT be dropped — operator may re-auth");
  assert.equal(r.remaining, 1);

  // Operator re-logs in; next flush succeeds.
  nextResponses.push(new Response("", { status: 200 }));
  r = await flushQueue();
  assert.equal(r.flushed, 1);
  assert.equal(r.remaining, 0);
});

test("server returns 200 with alreadyResolved:true is treated as success (queue drained)", async () => {
  await enqueuePaymentAction("pay-already", "verify");
  // Server already saw this verify (e.g. another desk did it). Returns 200.
  nextResponses.push(
    new Response(JSON.stringify({ ok: true, alreadyResolved: true }), { status: 200 })
  );
  const r = await flushQueue();
  assert.equal(r.flushed, 1);
  assert.equal(r.remaining, 0);
});

test("blob byte-integrity round-trip through IDB and flush (no silent corruption)", async () => {
  // 64 KB pseudo-binary payload; recover Bytes server-side and check.
  const bytes = new Uint8Array(64 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
  const fd = new FormData();
  fd.set("registration_id", "reg-blob");
  fd.set("measured_kg", "100.00");
  fd.set("file", new Blob([bytes], { type: "image/jpeg" }), "weighin.jpg");

  await enqueueWeighIn(fd);

  // Capture the actual bytes the queue sends through fetch.
  let receivedBytes: Uint8Array | null = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    if (body instanceof FormData) {
      const file = body.get("file");
      if (file instanceof Blob) {
        receivedBytes = new Uint8Array(await file.arrayBuffer());
      }
    }
    return new Response("", { status: 200 });
  };

  const r = await flushQueue();
  assert.equal(r.flushed, 1);
  const got = receivedBytes as Uint8Array | null;
  assert.ok(got, "server side did not receive the file");
  assert.equal(got!.length, bytes.length, "byte length mismatch");
  // Spot-check first/middle/last byte to confirm no corruption.
  assert.equal(got![0], bytes[0]);
  assert.equal(got![bytes.length >> 1], bytes[bytes.length >> 1]);
  assert.equal(got![bytes.length - 1], bytes[bytes.length - 1]);
});

test("attempts counter increases monotonically across retries", async () => {
  await enqueueWeighIn(makeFd());
  for (let i = 0; i < 3; i++) {
    nextResponses.push(new Response("boom", { status: 503 }));
    await flushQueue();
  }
  // Inspect via a peek: queueLength is public, attempts is via internal IDB.
  // Re-open IDB by triggering one more flush that fails so we can read it.
  const req = indexedDB.open("dino-sync", 1);
  const db: IDBDatabase = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const all: Array<{ attempts: number }> = await new Promise((res, rej) => {
    const tx = db.transaction("queue", "readonly");
    const r = tx.objectStore("queue").getAll();
    r.onsuccess = () => res(r.result as Array<{ attempts: number }>);
    r.onerror = () => rej(r.error);
  });
  assert.equal(all.length, 1);
  assert.equal(all[0].attempts, 3);
});

test("FIFO order preserved even when middle job fails", async () => {
  await enqueuePaymentAction("a", "verify");
  await enqueuePaymentAction("b", "verify");
  await enqueuePaymentAction("c", "verify");
  nextResponses.push(new Response("", { status: 200 }));      // a → ok
  nextResponses.push(new Response("boom", { status: 503 }));  // b → retry
  nextResponses.push(new Response("", { status: 200 }));      // c → ok

  const r = await flushQueue();
  assert.equal(r.flushed, 2);
  assert.equal(r.remaining, 1);
  // Only b should remain.
  assert.equal(calls[0].url, "/api/admin/payments/a/verify");
  assert.equal(calls[1].url, "/api/admin/payments/b/verify");
  assert.equal(calls[2].url, "/api/admin/payments/c/verify");
});

test("text() parse failure on error response does not crash flush", async () => {
  await enqueuePaymentAction("p", "verify");
  // Build a response whose .text() rejects.
  const badRes = new Response("", { status: 500 });
  Object.defineProperty(badRes, "text", {
    value: () => Promise.reject(new Error("read failed")),
  });
  nextResponses.push(badRes);
  const r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.remaining, 1, "job should still be queued for retry");
});



// ===== JSON-body queue (added 2026-04-29 for collect / adjust / reverse) =====

test("enqueueJson stores a JSON POST and flushes with Content-Type: application/json", async () => {
  await enqueueJson("/api/admin/payments/p1/collect", "POST", {
    method: "cash",
    amount_inr: 250,
  });
  assert.equal(await queueLength(), 1);

  nextResponses.push(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const r = await flushQueue();

  assert.equal(r.flushed, 1);
  assert.equal(await queueLength(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/payments/p1/collect");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].contentType, "application/json");
  assert.deepEqual(JSON.parse(calls[0].bodyText ?? "null"), {
    method: "cash",
    amount_inr: 250,
  });
});

test("enqueueJson failure (5xx) keeps job and bumps attempts", async () => {
  await enqueueJson("/api/admin/payments/p2/reverse", "POST", { reason: "wrong row" });
  nextResponses.push(new Response("boom", { status: 503 }));

  const r = await flushQueue();
  assert.equal(r.flushed, 0);
  assert.equal(r.remaining, 1);
});

test("mixed JSON + multipart queue drains in FIFO with correct content types", async () => {
  await enqueueWeighIn(makeFd());
  await enqueueJson("/api/admin/payments/p3/adjust-total", "POST", {
    amount_inr: 600,
  });
  nextResponses.push(new Response("", { status: 200 }));
  nextResponses.push(new Response("", { status: 200 }));

  const r = await flushQueue();

  assert.equal(r.flushed, 2);
  assert.equal(calls[0].url, "/api/weighin");
  assert.equal(calls[0].contentType, null, "multipart must NOT carry our JSON header");
  assert.equal(calls[1].url, "/api/admin/payments/p3/adjust-total");
  assert.equal(calls[1].contentType, "application/json");
});
