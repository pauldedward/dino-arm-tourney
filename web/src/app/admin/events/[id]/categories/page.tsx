import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { formatCategoryCodeShort } from "@/lib/rules/category-label";
import { loadLiveCategoryGroups } from "@/lib/registrations/live-categories";
import {
  challongeUrlSlug,
  listExistingTournaments,
  makeChallongeClient,
  resolveChallongeConfig,
  type ExistingTournament,
} from "@/lib/challonge/push";
import CategoriesChallongePanel, { type CategoryRow } from "./CategoriesChallongePanel";

export const dynamic = "force-dynamic";

type EventLite = {
  id: string;
  slug: string;
  name: string;
  challonge_enabled: boolean | null;
  challonge_subdomain: string | null;
  challonge_username: string | null;
  challonge_api_key: string | null;
};

export default async function CategoriesIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("operator", "/admin");
  const isSuper = session.role === "super_admin";
  const { id: idOrSlug } = await params;
  const svc = createServiceClient();

  const looksUuid = /^[0-9a-f]{8}-/.test(idOrSlug);
  const { data: event } = await svc
    .from("events")
    .select(
      "id, slug, name, challonge_enabled, challonge_subdomain, challonge_username, challonge_api_key",
    )
    .eq(looksUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();
  if (!event) redirect("/admin/events?gone=event");
  const ev = event as EventLite;
  // Page is operator-readable when integration is on; mutations (push /
  // replace / delete) are super-admin-only and gated below via `isSuper`.
  // Operators get a read-only view with live Challonge links so they can
  // jump into Challonge to manage the bracket.
  if (!ev.challonge_enabled) redirect(`/admin/events/${ev.slug}`);

  // Counts of on-mat entries per category — computed LIVE via
  // resolveEntries on registrations + latest weigh-in. Mirrors the
  // Category Sheet (web/src/app/admin/events/[id]/print/[kind]/page.tsx)
  // and the Challonge push API (loadCategoryParticipants) so what's
  // counted here, what prints on match-day, and what gets pushed to
  // Challonge are the exact same set. Reading live (instead of from the
  // materialised `entries` table) means new weigh-ins / overrides /
  // declared-weight edits show up immediately without a fixtures
  // regenerate step.
  const liveGroups = await loadLiveCategoryGroups(ev.id);
  const counts = new Map<string, number>();
  const allCodes = new Set<string>();
  for (const g of liveGroups) {
    counts.set(g.category_code, g.athletes.length);
    allCodes.add(g.category_code);
  }

  const baseRows: CategoryRow[] = [...allCodes].sort().map((code) => ({
    code,
    label: formatCategoryCodeShort(code),
    acceptedCount: counts.get(code) ?? 0,
    pushed: false,
    challongeUrl: null,
    challongeState: null,
    pushedParticipants: 0,
  }));

  const acceptedTotal = baseRows.reduce((s, r) => s + r.acceptedCount, 0);
  const enabled = isSuper; // mutations are super-admin only

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
            Challonge · {ev.name}
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight">Challonge</h1>
          <p className="mt-1 font-mono text-xs text-ink/60">
            {baseRows.length} categories · {acceptedTotal} accepted entries
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/events/${ev.slug}`}
            className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            ← Event
          </Link>
          {isSuper && (
            <Link
              href={`/admin/events/${ev.slug}/edit`}
              className="border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-wide hover:bg-ink hover:text-paper"
            >
              Edit event
            </Link>
          )}
        </div>
      </div>

      {!isSuper && (
        <p className="border-2 border-ink/40 bg-bone px-3 py-2 font-mono text-[11px] text-ink/70">
          Read-only view. Click the Challonge link on any row to manage that
          bracket directly. Push / replace / delete actions are restricted to
          super-admins.
        </p>
      )}

      <Suspense fallback={<ChallongeSectionSkeleton rows={baseRows} eventSlug={ev.slug} eventId={ev.id} enabled={enabled} />}>
        <ChallongeSection ev={ev} baseRows={baseRows} allCodes={allCodes} enabled={enabled} />
      </Suspense>
    </div>
  );
}

function ChallongeSectionSkeleton({
  rows,
  eventSlug,
  eventId,
  enabled,
}: {
  rows: CategoryRow[];
  eventSlug: string;
  eventId: string;
  enabled: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="border-2 border-ink p-4">
        <h2 className="font-display text-lg font-black">Challonge integration</h2>
        <p className="mt-2 font-mono text-xs text-ink/60">Loading live state from Challonge…</p>
      </div>
      <CategoriesChallongePanel
        eventId={eventId}
        eventSlug={eventSlug}
        enabled={false}
        subdomain={null}
        rows={rows}
        orphans={[]}
      />
    </section>
  );
}

async function ChallongeSection({
  ev,
  baseRows,
  allCodes,
  enabled,
}: {
  ev: EventLite;
  baseRows: CategoryRow[];
  allCodes: Set<string>;
  enabled: boolean;
}) {
  const cfgWarnings: string[] = [];
  let existing: Map<string, ExistingTournament> | null = null;
  let challongeError: string | null = null;
  let resolvedSubdomain: string | null = null;

  const cfg = resolveChallongeConfig({
    id: ev.id,
    slug: ev.slug,
    name: ev.name,
    challonge_enabled: true,
    challonge_api_key: ev.challonge_api_key,
    challonge_username: ev.challonge_username,
    challonge_subdomain: ev.challonge_subdomain,
  });
  if ("error" in cfg) {
    cfgWarnings.push(cfg.error);
  } else {
    resolvedSubdomain = cfg.subdomain;
    try {
      const ch = makeChallongeClient(cfg);
      existing = await listExistingTournaments(ch, cfg.subdomain);
    } catch (e) {
      challongeError = e instanceof Error ? e.message : String(e);
    }
  }

  const rows: CategoryRow[] = baseRows.map((r) => {
    const slug = challongeUrlSlug(ev.slug, r.code);
    const t = existing?.get(slug) ?? null;
    return {
      ...r,
      pushed: !!t,
      challongeUrl: t?.fullUrl ?? null,
      challongeState: t?.state ?? null,
      pushedParticipants: t?.participants ?? 0,
    };
  });

  // Orphans = tournaments under the subdomain whose URL slug doesn't map to
  // any current category. Common causes: category renamed/dropped, event slug
  // changed, slug-format change (e.g. the +/- collision fix). We surface
  // them so the operator can clean up without going to challonge.com.
  const knownSlugs = new Set([...allCodes].map((c) => challongeUrlSlug(ev.slug, c)));
  const orphans: ExistingTournament[] = existing
    ? [...existing.values()].filter((t) => !knownSlugs.has(t.url))
    : [];

  const pushedN = rows.filter((r) => r.pushed).length;
  const interactive = cfgWarnings.length === 0 && !challongeError;

  return (
    <section className="space-y-3">
      <div className="border-2 border-ink p-4">
        <h2 className="font-display text-lg font-black">Challonge integration</h2>
        {cfgWarnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-red-700">
            {cfgWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {cfgWarnings.length === 0 && challongeError && (
          <p className="mt-2 border-2 border-amber-700 bg-amber-50 px-2 py-1 font-mono text-xs text-amber-900">
            Challonge unreachable — status unknown, action buttons disabled.
            <br />
            {challongeError}
          </p>
        )}
        {interactive && (
          <p className="mt-2 font-mono text-xs text-ink/70">
            {resolvedSubdomain ? (
              <>
                Pushing under subdomain{" "}
                <a
                  className="underline hover:text-ink"
                  href={`https://${resolvedSubdomain}.challonge.com/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resolvedSubdomain}.challonge.com ↗
                </a>
                . {pushedN} of {rows.length} categories on Challonge.
              </>
            ) : (
              <>Pushing to bare account (no subdomain set). {pushedN} of {rows.length} on Challonge.</>
            )}
          </p>
        )}
      </div>

      <CategoriesChallongePanel
        eventId={ev.id}
        eventSlug={ev.slug}
        enabled={enabled && interactive}
        subdomain={resolvedSubdomain}
        rows={rows}
        orphans={orphans.map((o) => ({
          url: o.url,
          state: o.state,
          participants: o.participants,
          fullUrl: o.fullUrl,
        }))}
      />
    </section>
  );
}
