// Minimal Challonge API v1 client (Node, no deps).
//
// Auth: HTTP Basic (username = your Challonge username, password = api key)
// Base: https://api.challonge.com/v1/
//
// All v1 endpoints take form-encoded bodies with bracketed names like
// `tournament[name]=...`. We expose a tiny `flatten(obj, prefix)` helper.

const BASE = "https://api.challonge.com/v1";

// Challonge's documented rate limit is ~30 req/min per API key. Empirically
// confirmed: without pacing, ~51 sequential successes then 401 wall. We pace
// ALL requests through a single global queue so any caller — push-all loops,
// orphan deletes, page-load probes — stays under the limit. 2100ms gap ≈ 28
// req/min, comfortably under. NOT a backoff: every request waits this gap
// regardless of success/failure. Failures still throw on the first attempt.
const MIN_GAP_MS = 2100;
let nextSlotAt = 0;
async function reserveSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== null && typeof item === "object") {
          out.push(...flatten(item, `${key}[]`));
        } else {
          out.push([`${key}[]`, String(item)]);
        }
      }
    } else if (v !== null && typeof v === "object") {
      out.push(...flatten(v, key));
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

function toForm(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of flatten(obj)) params.append(k, v);
  return params;
}

export function makeClient({ username, apiKey, base = BASE } = {}) {
  if (!username) throw new Error("makeClient: username required");
  if (!apiKey) throw new Error("makeClient: apiKey required");
  const auth = "Basic " + Buffer.from(`${username}:${apiKey}`).toString("base64");

  async function request(method, path, { body, query } = {}) {
    await reserveSlot();
    const url = new URL(`${base}${path}`);
    if (query) {
      for (const [k, v] of flatten(query)) url.searchParams.append(k, v);
    }
    const headers = {
      Authorization: auth,
      Accept: "application/json",
    };
    let init = { method, headers };
    if (body !== undefined) {
      const form = toForm(body);
      init.body = form;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Challonge ${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  return {
    request,
    listTournaments: (q) => request("GET", "/tournaments.json", { query: q }),
    createTournament: (attrs) =>
      request("POST", "/tournaments.json", { body: { tournament: attrs } }),
    showTournament: (idOrUrl, q) =>
      request("GET", `/tournaments/${encodeURIComponent(idOrUrl)}.json`, { query: q }),
    deleteTournament: (idOrUrl) =>
      request("DELETE", `/tournaments/${encodeURIComponent(idOrUrl)}.json`),
    bulkAddParticipants: (idOrUrl, participants) =>
      request("POST", `/tournaments/${encodeURIComponent(idOrUrl)}/participants/bulk_add.json`,
        { body: { participants } }),
    listParticipants: (idOrUrl) =>
      request("GET", `/tournaments/${encodeURIComponent(idOrUrl)}/participants.json`),
  };
}
