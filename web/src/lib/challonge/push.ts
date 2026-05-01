// Server-side Challonge push/delete logic for the in-app integration.
//
// Reuses the Node API v1 client at ./client.mjs. Reads per-event settings
// (challonge_api_key/username/subdomain) from the events row and falls back
// to CHALLONGE_API_KEY / CHALLONGE_USERNAME env vars where blank.
//
// Participant set is the ON-MAT roster for each category — must match
// the Category Sheet (web/src/app/admin/events/[id]/print/[kind]/page.tsx):
//   registrations.lifecycle_status = 'active'
//   registrations.discipline_status = 'clear'
//   registrations.checkin_status   = 'weighed_in'
// i.e. the athlete is on the scale and not disqualified. Anyone who paid
// but never showed up is excluded so what gets pushed to Challonge is
// what the operator prints on match-day.
//
// Within a category, participants are sorted by chest_no asc and then
// shuffled by `spreadByDistrict` so same-district athletes don't meet in
// round 1 when avoidable. Bracket positions = list order (Challonge
// sequential_pairings = true).

import { formatCategoryCodeShort } from "@/lib/rules/category-label";
import { loadLiveCategoryGroups } from "@/lib/registrations/live-categories";
// `client.mjs` is plain JS with no published types; treat the import as opaque.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- .mjs has no .d.ts; runtime shape is documented below.
import { makeClient } from "./client.mjs";

export type ChallongeConfig = {
  username: string;
  apiKey: string;
  subdomain: string | null;
};

export type EventChallongeRow = {
  id: string;
  slug: string;
  name: string;
  challonge_enabled: boolean;
  challonge_api_key: string | null;
  challonge_username: string | null;
  challonge_subdomain: string | null;
};

export type Participant = {
  name: string;
  district: string;
  chest_no: number | null;
};

export type PushResult = {
  code: string;
  ok: boolean;
  replaced?: boolean;
  skipped?: boolean;
  reason?: string;
  challongeId?: number | null;
  challongeUrl?: string | null;
  fullUrl?: string | null;
  participants?: number;
  error?: string;
};

export type DeleteResult = {
  code: string;
  ok: boolean;
  notFound?: boolean;
  error?: string;
};

// ── config resolution ──────────────────────────────────────────────────────

export function resolveChallongeConfig(event: EventChallongeRow): ChallongeConfig | { error: string } {
  const username = event.challonge_username?.trim() || process.env.CHALLONGE_USERNAME?.trim();
  const apiKey = event.challonge_api_key?.trim() || process.env.CHALLONGE_API_KEY?.trim();
  const subdomain = event.challonge_subdomain?.trim() || null;
  if (!username) return { error: "Challonge username not configured (set on event or CHALLONGE_USERNAME env)." };
  if (!apiKey) return { error: "Challonge API key not configured (set on event or CHALLONGE_API_KEY env)." };
  return { username, apiKey, subdomain };
}

// ── slug + label helpers ───────────────────────────────────────────────────

export function challongeUrlSlug(eventSlug: string, code: string): string {
  // For the event slug, just lowercase + alnum-collapse (no risk of +/-
  // collisions in slugs we generate). For the category code, encode +/-
  // distinctly so e.g. "M-+80 kg-R" and "M-−80 kg-R" don't hash to the
  // same Challonge URL ('+' → 'p', '-' / U+2212 → 'm').
  const safeEventSlug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const safeCode = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\u2212/g, "m")
      .replace(/\+/g, "p")
      .replace(/-/g, "m")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return `${safeEventSlug(eventSlug)}_${safeCode(code)}`.slice(0, 60);
}

export function categoryLabel(code: string): string {
  return formatCategoryCodeShort(code);
}

// ── district-spread shuffle ────────────────────────────────────────────────

export function spreadByDistrict<T extends { district: string }>(arr: T[]): T[] {
  const n = arr.length;
  if (n < 3) return arr.slice();
  const groups = new Map<string, T[]>();
  for (const p of arr) {
    const k = p.district || "__none__";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  const buckets = [...groups.entries()].map(([k, list]) => ({ k, list }));
  const out: T[] = [];
  let lastKey: string | null = null;
  while (out.length < n) {
    buckets.sort((a, b) => b.list.length - a.list.length);
    let pick = buckets.find((b) => b.list.length > 0 && b.k !== lastKey);
    if (!pick) pick = buckets.find((b) => b.list.length > 0);
    if (!pick) break;
    out.push(pick.list.shift()!);
    lastKey = pick.k;
  }
  // Fix-up: scan adjacent pairs, swap to break round-1 conflicts.
  for (let i = 0; i + 1 < n; i += 2) {
    if (!out[i].district || out[i].district !== out[i + 1].district) continue;
    for (let j = i + 2; j < n; j++) {
      const partnerIdx = j % 2 === 0 ? j + 1 : j - 1;
      const partner = out[partnerIdx];
      const cand = out[j];
      if (cand.district === out[i].district) continue;
      if (partner && partner.district === out[i + 1].district) continue;
      [out[i + 1], out[j]] = [out[j], out[i + 1]];
      break;
    }
  }
  return out;
}

// ── participant loader ─────────────────────────────────────────────────────
//
// Source: live `loadLiveCategoryGroups` (registrations + latest weigh-in,
// fed through `resolveEntries`). We deliberately do NOT read the
// materialised `entries` table here so the Challonge push always matches
// what the operator sees on the Category Sheet and the Challonge admin
// page — no fixtures-regenerate step required.

export async function loadCategoryParticipants(
  eventId: string,
  codes?: string[],
): Promise<Map<string, Participant[]>> {
  const groups = await loadLiveCategoryGroups(eventId);
  const wanted = codes && codes.length > 0 ? new Set(codes) : null;

  const byCat = new Map<string, Participant[]>();
  for (const g of groups) {
    if (wanted && !wanted.has(g.category_code)) continue;
    const list: Participant[] = [];
    for (const a of g.athletes) {
      const fullName = (a.full_name ?? "").trim() || "(unnamed)";
      const district = (a.district ?? "").trim();
      const chestPart = a.chest_no != null ? `#${a.chest_no} ` : "";
      const distPart = district ? ` — ${district}` : "";
      list.push({
        name: `${chestPart}${fullName}${distPart}`,
        district,
        chest_no: a.chest_no,
      });
    }
    byCat.set(g.category_code, list);
  }

  // Sort each category by chest_no (then name) for a stable pre-shuffle order,
  // then apply district-spread.
  for (const [code, list] of byCat) {
    list.sort((a, b) => {
      const ca = a.chest_no ?? Number.POSITIVE_INFINITY;
      const cb = b.chest_no ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
    byCat.set(code, spreadByDistrict(list));
  }

  return byCat;
}

// ── tournament settings (must match the standalone script) ─────────────────

function tournamentAttrs(opts: {
  name: string;
  url: string;
  eventName: string;
  code: string;
  subdomain: string | null;
}): Record<string, unknown> {
  return {
    name: opts.name,
    url: opts.url,
    tournament_type: "double elimination",
    game_name: "Arm Wrestling",
    description: `Auto-pushed from dino-arm-tourney for event "${opts.eventName}". Category code: ${opts.code}.`,
    open_signup: false,
    hold_third_place_match: false,
    grand_finals_modifier: "",
    sequential_pairings: true, // bracket positions = list order, NOT 1-vs-N seeding
    show_rounds: true,
    hide_seeds: true,
    hide_forum: true,
    quick_advance: true,
    accept_attachments: false,
    private: false,
    ...(opts.subdomain ? { subdomain: opts.subdomain } : {}),
  };
}

// ── push / delete a single category ────────────────────────────────────────

type ChallongeClient = ReturnType<typeof makeClient>;
type ShowResp = { tournament?: { id?: number; url?: string; state?: string } };
type CreateResp = { tournament?: { id?: number; url?: string } };
type ParticipantPayload = { name: string; seed: number };

export async function pushOneCategory(args: {
  ch: ChallongeClient;
  event: EventChallongeRow;
  subdomain: string | null;
  code: string;
  participants: Participant[];
  replace: boolean;
  /**
   * Pre-fetched state of this URL slug from `listExistingTournaments`. When
   * provided we skip the per-category `showTournament` round-trip (saves
   * one Challonge HTTP call per category — meaningful for 200+ categories).
   * Pass `null` to indicate "we checked and it doesn't exist".
   * Omit (undefined) to fall back to the legacy showTournament probe.
   */
  existing?: ExistingTournament | null;
}): Promise<PushResult> {
  const { ch, event, subdomain, code, participants, replace, existing } = args;
  const url = challongeUrlSlug(event.slug, code);
  const lookupKey = subdomain ? `${subdomain}-${url}` : url;
  const label = categoryLabel(code);
  let wasReplaced = false;

  // ── Existence check ──
  // Prefer the caller-supplied snapshot (saves an HTTP round-trip). Fall
  // back to a per-category showTournament probe only when no snapshot was
  // passed, for backward compatibility.
  let foundState: string | null = null;
  let foundId: number | null = null;
  let foundUrl: string | null = null;
  if (existing !== undefined) {
    if (existing) {
      foundState = existing.state;
      foundId = existing.id;
      foundUrl = existing.url;
    }
  } else {
    try {
      const probe = (await ch.showTournament(lookupKey)) as ShowResp;
      const t = probe?.tournament ?? (probe as unknown as ShowResp["tournament"]);
      if (t) {
        foundState = t.state ?? "unknown";
        foundId = t.id ?? null;
        foundUrl = t.url ?? null;
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 404) {
        const m = e instanceof Error ? e.message : String(e);
        return { code, ok: false, error: `pre-check: ${m}` };
      }
    }
  }

  if (foundState !== null) {
    if (replace) {
      if (foundState !== "pending") {
        return {
          code,
          ok: false,
          skipped: true,
          reason: `cannot replace, state=${foundState}`,
          challongeId: foundId,
          challongeUrl: foundUrl ?? url,
        };
      }
      try {
        await ch.deleteTournament(lookupKey);
        wasReplaced = true;
      } catch (delErr) {
        const m = delErr instanceof Error ? delErr.message : String(delErr);
        return { code, ok: false, error: `replace-delete: ${m}` };
      }
    } else {
      const fullUrl = subdomain
        ? `https://${subdomain}.challonge.com/${foundUrl ?? url}`
        : `https://challonge.com/${foundUrl ?? url}`;
      return {
        code,
        ok: true,
        skipped: true,
        reason: "exists; pass replace=true to overwrite",
        challongeId: foundId,
        challongeUrl: foundUrl ?? url,
        fullUrl,
      };
    }
  }

  try {
    const created = (await ch.createTournament(
      tournamentAttrs({ name: label, url, eventName: event.name, code, subdomain }),
    )) as CreateResp;
    const t = created?.tournament ?? (created as unknown as CreateResp["tournament"]);
    const newUrl = t?.url ?? url;
    const id = t?.id ?? null;
    const pathKey = subdomain ? `${subdomain}-${newUrl}` : newUrl;
    const fullUrl = subdomain
      ? `https://${subdomain}.challonge.com/${newUrl}`
      : `https://challonge.com/${newUrl}`;
    if (participants.length > 0) {
      const payload: ParticipantPayload[] = participants.map((p, i) => ({ name: p.name, seed: i + 1 }));
      await ch.bulkAddParticipants(pathKey, payload);
    }
    return {
      code,
      ok: true,
      replaced: wasReplaced,
      challongeId: id,
      challongeUrl: newUrl,
      fullUrl,
      participants: participants.length,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { code, ok: false, error: m };
  }
}

export async function deleteOneCategory(args: {
  ch: ChallongeClient;
  event: EventChallongeRow;
  subdomain: string | null;
  code: string;
}): Promise<DeleteResult> {
  const { ch, event, subdomain, code } = args;
  const url = challongeUrlSlug(event.slug, code);
  const lookupKey = subdomain ? `${subdomain}-${url}` : url;
  try {
    await ch.deleteTournament(lookupKey);
    return { code, ok: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404) return { code, ok: true, notFound: true };
    const m = e instanceof Error ? e.message : String(e);
    return { code, ok: false, error: m };
  }
}

// ── live state lookup (replaces the old tracking table) ────────────────────
//
// One `GET /tournaments.json?subdomain=...` returns every tournament under
// the subdomain. We key by url-slug so the categories page can join in O(1)
// per category without hitting Challonge once per row.

export type ExistingTournament = {
  id: number | null;
  url: string;
  state: string;
  participants: number;
  fullUrl: string;
};

type ListItem = {
  tournament?: {
    id?: number;
    url?: string;
    state?: string;
    participants_count?: number;
    full_challonge_url?: string;
    subdomain?: string | null;
  };
};

export async function listExistingTournaments(
  ch: ChallongeClient,
  subdomain: string | null,
): Promise<Map<string, ExistingTournament>> {
  const query = subdomain ? { subdomain } : undefined;
  const list = (await ch.listTournaments(query)) as ListItem[];
  const out = new Map<string, ExistingTournament>();
  for (const item of list ?? []) {
    const t = item.tournament;
    if (!t?.url) continue;
    out.set(t.url, {
      id: t.id ?? null,
      url: t.url,
      state: t.state ?? "unknown",
      participants: t.participants_count ?? 0,
      fullUrl:
        t.full_challonge_url ??
        (subdomain
          ? `https://${subdomain}.challonge.com/${t.url}`
          : `https://challonge.com/${t.url}`),
    });
  }
  return out;
}

// ── public top-level: push / delete many ───────────────────────────────────

export function makeChallongeClient(cfg: ChallongeConfig): ChallongeClient {
  return makeClient({ username: cfg.username, apiKey: cfg.apiKey });
}

/**
 * Run `fn` over `items` with bounded concurrency. Results preserve input
 * order. Used to fan out per-category Challonge calls without tripping the
 * v1 burst limit (~30 concurrent → 401). 4–6 is the sweet spot empirically.
 */
export async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
