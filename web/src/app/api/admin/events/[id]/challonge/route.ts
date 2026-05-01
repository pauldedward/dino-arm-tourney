import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import {
  challongeUrlSlug,
  deleteOneCategory,
  listExistingTournaments,
  loadCategoryParticipants,
  makeChallongeClient,
  pushOneCategory,
  resolveChallongeConfig,
  type DeleteResult,
  type EventChallongeRow,
  type PushResult,
} from "@/lib/challonge/push";

export const runtime = "nodejs";
export const maxDuration = 300; // streaming; 200+ categories may take a few minutes

// Sequential. Challonge v1 has a tight per-key burst limit (returns 401 when
// exceeded) and we'd rather fail loudly per-category than retry/throttle.
// Each category is one HTTP attempt; failures surface in the per-row
// results and the operator re-pushes them individually.
const CONCURRENCY = 1;

type Body = {
  codes?: string[]; // empty/missing = ALL (POST only)
  replace?: boolean; // POST only
  slugs?: string[]; // DELETE-only orphan cleanup (raw Challonge URL slugs)
};

type OrphanResult = { slug: string; ok: boolean; notFound?: boolean; error?: string };

type Op = "push" | "replace" | "delete" | "delete_orphans";

type StreamEvent =
  | { type: "start"; total: number; op: Op }
  | { type: "result"; index: number; result: PushResult | DeleteResult | OrphanResult }
  | { type: "done"; ok: true; total: number; okCount: number; failCount: number; skipCount: number }
  | { type: "error"; error: string };

async function loadEvent(idOrSlug: string): Promise<EventChallongeRow | null> {
  const svc = createServiceClient();
  const looksUuid = /^[0-9a-f]{8}-/.test(idOrSlug);
  const { data } = await svc
    .from("events")
    .select(
      "id, slug, name, challonge_enabled, challonge_api_key, challonge_username, challonge_subdomain",
    )
    .eq(looksUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();
  return (data as EventChallongeRow | null) ?? null;
}

function parseCodes(body: Body): string[] | null {
  if (!body.codes || body.codes.length === 0) return null;
  const arr = body.codes.filter((c) => typeof c === "string" && c.trim().length > 0);
  return arr.length > 0 ? arr : null;
}

/**
 * Build a streaming NDJSON response. The work() callback is given a `write`
 * function to emit per-result events; we tally success/skip/fail and emit
 * `start` and `done` envelope events automatically.
 */
function streamResponse(
  op: Op,
  total: number,
  work: (
    write: (ev: Extract<StreamEvent, { type: "result" }>) => void,
  ) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      send({ type: "start", total, op });
      let okCount = 0;
      let failCount = 0;
      let skipCount = 0;
      try {
        await work((ev) => {
          const r = ev.result as { ok: boolean; skipped?: boolean };
          if (r.skipped) skipCount += 1;
          else if (r.ok) okCount += 1;
          else failCount += 1;
          send(ev);
        });
        send({ type: "done", ok: true, total, okCount, failCount, skipCount });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Bounded-concurrency worker pool that invokes `onResult` as soon as each
 * item finishes (in completion order, not input order). Returns the full
 * results array in input order once everything settles.
 */
async function pMapStreaming<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult: (index: number, result: R) => void,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        const r = await fn(items[i], i);
        out[i] = r;
        onResult(i, r);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// ── POST: push or replace ──────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireRole("super_admin", `/admin/events/${id}/categories`);
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;

  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!event.challonge_enabled) {
    return NextResponse.json(
      { error: "Challonge integration is disabled for this event." },
      { status: 400 },
    );
  }

  const cfg = resolveChallongeConfig(event);
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 400 });
  const ch = makeChallongeClient(cfg);

  const requestedCodes = parseCodes(body);
  const byCat = await loadCategoryParticipants(event.id, requestedCodes ?? undefined);

  if (requestedCodes) {
    const missing = requestedCodes.filter((c) => !byCat.has(c) || byCat.get(c)!.length === 0);
    if (missing.length === requestedCodes.length) {
      return NextResponse.json(
        { error: `No accepted entries for: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const codes = requestedCodes ?? [...byCat.keys()];

  // One subdomain-wide snapshot up front, used by every worker so each
  // pushOneCategory skips its own showTournament probe.
  let existing: Awaited<ReturnType<typeof listExistingTournaments>> | null = null;
  try {
    existing = await listExistingTournaments(ch, cfg.subdomain);
  } catch {
    existing = null;
  }

  const op: Op = body.replace ? "replace" : "push";

  return streamResponse(op, codes.length, async (write) => {
    const results = await pMapStreaming(
      codes,
      CONCURRENCY,
      async (code) => {
        const participants = byCat.get(code) ?? [];
        if (participants.length === 0) {
          return {
            code,
            ok: false,
            skipped: true,
            reason: "no accepted entries",
          } as PushResult;
        }
        const slug = challongeUrlSlug(event.slug, code);
        const snapshot = existing ? existing.get(slug) ?? null : undefined;
        return pushOneCategory({
          ch,
          event,
          subdomain: cfg.subdomain,
          code,
          participants,
          replace: !!body.replace,
          existing: snapshot,
        });
      },
      (index, result) => write({ type: "result", index, result }),
    );

    await recordAudit({
      eventId: event.id,
      actorId: session.userId,
      actorLabel: session.fullName ?? session.email,
      action: body.replace ? "challonge.replace" : "challonge.push",
      targetTable: "events",
      targetId: event.id,
      payload: {
        codes,
        results: results.map((r) => ({
          code: r.code,
          ok: r.ok,
          skipped: r.skipped,
          error: r.error,
        })),
      },
    });
  });
}

// ── DELETE: by category codes OR raw orphan slugs ──────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireRole("super_admin", `/admin/events/${id}/categories`);
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;

  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!event.challonge_enabled) {
    return NextResponse.json(
      { error: "Challonge integration is disabled for this event." },
      { status: 400 },
    );
  }

  const cfg = resolveChallongeConfig(event);
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 400 });
  const ch = makeChallongeClient(cfg);

  const rawSlugs = Array.isArray(body.slugs)
    ? body.slugs.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];

  if (rawSlugs.length > 0) {
    return streamResponse("delete_orphans", rawSlugs.length, async (write) => {
      const results = await pMapStreaming(
        rawSlugs,
        CONCURRENCY,
        async (slug): Promise<OrphanResult> => {
          const lookupKey = cfg.subdomain ? `${cfg.subdomain}-${slug}` : slug;
          try {
            await ch.request("DELETE", `/tournaments/${encodeURIComponent(lookupKey)}.json`);
            return { slug, ok: true };
          } catch (e) {
            const status = (e as { status?: number }).status;
            if (status === 404) return { slug, ok: true, notFound: true };
            const m = e instanceof Error ? e.message : String(e);
            return { slug, ok: false, error: m };
          }
        },
        (index, result) => write({ type: "result", index, result }),
      );
      await recordAudit({
        eventId: event.id,
        actorId: session.userId,
        actorLabel: session.fullName ?? session.email,
        action: "challonge.delete_orphans",
        targetTable: "events",
        targetId: event.id,
        payload: { slugs: rawSlugs, results },
      });
    });
  }

  const codes = parseCodes(body);
  if (!codes || codes.length === 0) {
    return NextResponse.json(
      { error: "DELETE requires explicit codes or slugs; refresh the page to see what is pushed." },
      { status: 400 },
    );
  }

  return streamResponse("delete", codes.length, async (write) => {
    const results = await pMapStreaming(
      codes,
      CONCURRENCY,
      (code) => deleteOneCategory({ ch, event, subdomain: cfg.subdomain, code }),
      (index, result) => write({ type: "result", index, result }),
    );
    await recordAudit({
      eventId: event.id,
      actorId: session.userId,
      actorLabel: session.fullName ?? session.email,
      action: "challonge.delete",
      targetTable: "events",
      targetId: event.id,
      payload: { codes, results },
    });
  });
}
