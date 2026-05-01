"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";

export type CategoryRow = {
  code: string;
  label: string;
  acceptedCount: number;
  pushed: boolean;
  challongeUrl: string | null;
  challongeState: string | null;
  pushedParticipants: number;
};

export type OrphanRow = {
  url: string;
  state: string;
  participants: number;
  fullUrl: string;
};

type ResultEntry = {
  code?: string;
  slug?: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  fullUrl?: string | null;
  participants?: number;
  notFound?: boolean;
};

type Status = {
  busy: boolean;
  message: string | null;
  tone: "ok" | "warn" | "error" | null;
  progress?: { done: number; total: number; latest?: string } | null;
};

const TONE_CLASS: Record<NonNullable<Status["tone"]>, string> = {
  ok: "border-green-700 bg-green-50 text-green-900",
  warn: "border-amber-700 bg-amber-50 text-amber-900",
  error: "border-red-700 bg-red-50 text-red-900",
};

export default function CategoriesChallongePanel({
  eventId,
  eventSlug,
  enabled,
  subdomain,
  rows: initialRows,
  orphans: initialOrphans,
}: {
  eventId: string;
  eventSlug: string;
  enabled: boolean;
  subdomain: string | null;
  rows: CategoryRow[];
  orphans: OrphanRow[];
}) {
  const router = useRouter();
  const askConfirm = useConfirm();
  // Local mirror of the server-rendered rows so per-item results update the
  // table the moment its HTTP response arrives, without waiting for
  // router.refresh() to re-fetch the whole listExistingTournaments listing.
  // Re-syncs whenever the prop changes (page nav / router.refresh).
  const [localRows, setLocalRows] = useState<CategoryRow[]>(initialRows);
  const lastRowsRef = useRef(initialRows);
  if (lastRowsRef.current !== initialRows) {
    lastRowsRef.current = initialRows;
    setLocalRows(initialRows);
  }
  const [localOrphans, setLocalOrphans] = useState<OrphanRow[]>(initialOrphans);
  const lastOrphansRef = useRef(initialOrphans);
  if (lastOrphansRef.current !== initialOrphans) {
    lastOrphansRef.current = initialOrphans;
    setLocalOrphans(initialOrphans);
  }
  const [status, setStatus] = useState<Status>({ busy: false, message: null, tone: null });
  const [perCode, setPerCode] = useState<Map<string, "push" | "delete" | null>>(new Map());
  const [orphanBusy, setOrphanBusy] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pushed" | "unpushed" | "with-entries">("all");
  const [gender, setGender] = useState<"any" | "men" | "women">("any");
  const [discipline, setDiscipline] = useState<"any" | "para" | "nonpara">("any");
  const [arm, setArm] = useState<"any" | "L" | "R">("any");

  // Categorise each row from its human label (already computed server-side
  // via `formatCategoryCode`). Para classes are prefixed "Para "; women's
  // labels contain the word "Women". Cheap O(rows) classification, no
  // hard-coded prefix lists to drift out of sync with the WAF table.
  function classify(label: string): { gender: "men" | "women"; para: boolean } {
    return {
      gender: /\bWomen\b/i.test(label) ? "women" : "men",
      para: /^Para\b/i.test(label),
    };
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return localRows.filter((r) => {
      if (q && !r.code.toLowerCase().includes(q) && !r.label.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "pushed" && !r.pushed) return false;
      if (filter === "unpushed" && r.pushed) return false;
      if (filter === "with-entries" && r.acceptedCount === 0) return false;
      const c = classify(r.label);
      if (gender !== "any" && c.gender !== gender) return false;
      if (discipline === "para" && !c.para) return false;
      if (discipline === "nonpara" && c.para) return false;
      if (arm !== "any") {
        const j = r.code.lastIndexOf("-");
        const a = j > 0 ? r.code.slice(j + 1) : "";
        if (a !== arm) return false;
      }
      return true;
    });
  }, [localRows, query, filter, gender, discipline, arm]);

  function setBusyFor(code: string | null, kind: "push" | "delete" | null) {
    setPerCode((prev) => {
      const next = new Map(prev);
      if (code === null) next.clear();
      else if (kind === null) next.delete(code);
      else next.set(code, kind);
      return next;
    });
  }

  // Optimistic per-row updates so the table reflects each result the moment
  // its HTTP response arrives, without waiting for router.refresh() to
  // re-fetch the whole listing.
  function applyPushResult(code: string, r: ResultEntry) {
    if (!r.ok || r.skipped) return;
    setLocalRows((prev) =>
      prev.map((row) =>
        row.code === code
          ? {
              ...row,
              pushed: true,
              challongeUrl: r.fullUrl ?? row.challongeUrl,
              challongeState: "pending",
              pushedParticipants:
                typeof r.participants === "number" ? r.participants : row.acceptedCount,
            }
          : row,
      ),
    );
  }
  function applyDeleteResult(code: string, r: ResultEntry) {
    if (!r.ok && !r.notFound) return;
    setLocalRows((prev) =>
      prev.map((row) =>
        row.code === code
          ? {
              ...row,
              pushed: false,
              challongeUrl: null,
              challongeState: null,
              pushedParticipants: 0,
            }
          : row,
      ),
    );
  }
  function applyOrphanDelete(slug: string, r: ResultEntry) {
    if (!r.ok && !r.notFound) return;
    setLocalOrphans((prev) => prev.filter((o) => o.url !== slug));
  }

  /**
   * Stream the API call as NDJSON and update progress live. Emits one
   * `result` event per category as it completes (in completion order, not
   * input order). Returns the full results array on completion.
   *
   * The server emits these event shapes (one per line):
   *   {"type":"start","total":N,"op":"push"|"replace"|...}
   *   {"type":"result","index":i,"result":{...}}
   *   {"type":"done","ok":true,"total":N,"okCount":x,"failCount":y,"skipCount":z}
   *   {"type":"error","error":"..."}
   */
  async function runStream(
    method: "POST" | "DELETE",
    body: { codes?: string[]; replace?: boolean; slugs?: string[] },
    onProgress?: (done: number, total: number, latest: ResultEntry) => void,
  ): Promise<ResultEntry[]> {
    const res = await fetch(`/api/admin/events/${eventId}/challonge`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // Non-streaming error responses (validation, auth, etc) are JSON.
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    if (!res.body) throw new Error("no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const results: ResultEntry[] = [];
    let total = 0;
    let done = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) continue;
        let ev: { type: string; total?: number; index?: number; result?: ResultEntry; error?: string };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "start" && typeof ev.total === "number") {
          total = ev.total;
        } else if (ev.type === "result" && ev.result) {
          done += 1;
          if (typeof ev.index === "number") results[ev.index] = ev.result;
          else results.push(ev.result);
          onProgress?.(done, total, ev.result);
        } else if (ev.type === "error") {
          throw new Error(ev.error ?? "server error");
        }
      }
    }
    // Compact (some indices may be undefined if server didn't emit indexed events).
    return results.filter((r) => r != null);
  }

  /**
   * Bulk-runner: fire one request PER item rather than one fat request for
   * the whole batch. Each request stays well under Vercel's 300s function
   * timeout (typically 3-5s incl. server-side rate-pacer). Sequential by
   * design — Challonge's per-key limit is the binding constraint, not us.
   */
  async function runPerItem<T>(
    items: T[],
    buildBody: (item: T) => { codes?: string[]; replace?: boolean; slugs?: string[] },
    method: "POST" | "DELETE",
    onProgress: (done: number, total: number, latest: ResultEntry, item: T) => void,
  ): Promise<ResultEntry[]> {
    const all: ResultEntry[] = [];
    let done = 0;
    const total = items.length;
    for (const item of items) {
      let r: ResultEntry;
      try {
        const res = await runStream(method, buildBody(item));
        r = res[0] ?? { ok: false, error: "no result" };
      } catch (e) {
        r = { ok: false, error: (e as Error).message };
      }
      all.push(r);
      done += 1;
      onProgress(done, total, r, item);
      // Stop on first hard failure so we don't keep hammering Challonge in
      // the background after something went wrong (e.g. rate-limit / auth).
      // Skipped items are not failures and don't abort the run.
      if (!r.ok && !r.skipped) break;
    }
    return all;
  }

  async function deleteOrphan(slug: string) {
    if (!enabled) return;
    const ok = await askConfirm({
      message: `Delete orphan tournament “${slug}” from Challonge? It does not match any current category and will be removed from the subdomain. Cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setOrphanBusy((prev) => new Set(prev).add(slug));
    try {
      const results = await runStream("DELETE", { slugs: [slug] });
      const r = results[0];
      if (r) applyOrphanDelete(slug, r);
      setStatus({
        busy: false,
        message: r?.ok ? `Deleted orphan ${slug}.` : `Failed: ${r?.error ?? "unknown"}`,
        tone: r?.ok ? "ok" : "error",
      });
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    } finally {
      setOrphanBusy((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  }

  async function deleteAllOrphans() {
    if (!enabled || localOrphans.length === 0) return;
    const ok = await askConfirm({
      message: `Delete all ${localOrphans.length} orphan tournaments from Challonge? They do not match any current category. Cannot be undone.`,
      confirmLabel: `Delete ${localOrphans.length}`,
      tone: "danger",
    });
    if (!ok) return;
    setStatus({
      busy: true,
      message: `Deleting orphans…`,
      tone: null,
      progress: { done: 0, total: localOrphans.length },
    });
    try {
      const results = await runPerItem(
        localOrphans.map((o) => o.url),
        (slug) => ({ slugs: [slug] }),
        "DELETE",
        (done, total, latest, slug) => {
          applyOrphanDelete(slug, latest);
          setStatus((s) => ({
            ...s,
            busy: true,
            message: `Deleting orphans…`,
            progress: { done, total, latest: latest.slug ?? slug },
          }));
        },
      );
      setStatus(summarize(results, "delete"));
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    }
  }

  function summarize(results: ResultEntry[], op: "push" | "replace" | "delete"): Status {
    const okN = results.filter((r) => r.ok && !r.skipped).length;
    const skippedN = results.filter((r) => r.skipped).length;
    const failedN = results.filter((r) => !r.ok && !r.skipped).length;
    const verb = op === "delete" ? "Deleted" : op === "replace" ? "Replaced" : "Pushed";
    let tone: Status["tone"] = "ok";
    if (failedN > 0) tone = "error";
    else if (skippedN > 0 && okN === 0) tone = "warn";
    const parts = [`${verb} ${okN}`];
    if (skippedN > 0) parts.push(`skipped ${skippedN}`);
    if (failedN > 0) {
      const firstErr = results.find((r) => !r.ok && !r.skipped);
      parts.push(`failed ${failedN}${firstErr?.error ? ` (e.g. ${firstErr.error})` : ""}`);
    }
    if (skippedN > 0 && tone !== "error") {
      const firstSkip = results.find((r) => r.skipped);
      if (firstSkip?.reason) parts.push(`reason: ${firstSkip.reason}`);
    }
    return { busy: false, message: parts.join(" · "), tone };
  }

  async function pushOne(code: string, replace: boolean) {
    if (!enabled) return;
    if (replace) {
      const ok = await askConfirm({
        message: `Replace tournament for ${code} on Challonge? This deletes the existing one (only allowed while it is in 'pending' state) and recreates it.`,
        confirmLabel: "Replace",
        tone: "warn",
      });
      if (!ok) return;
    }
    setBusyFor(code, "push");
    try {
      const results = await runStream("POST", { codes: [code], replace });
      const r = results[0];
      if (r) applyPushResult(code, r);
      setStatus(summarize(results, replace ? "replace" : "push"));
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    } finally {
      setBusyFor(code, null);
    }
  }

  async function deleteOne(code: string) {
    if (!enabled) return;
    const ok = await askConfirm({
      message: `Delete the Challonge tournament for ${code}? Cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setBusyFor(code, "delete");
    try {
      const results = await runStream("DELETE", { codes: [code] });
      const r = results[0];
      if (r) applyDeleteResult(code, r);
      setStatus(summarize(results, "delete"));
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    } finally {
      setBusyFor(code, null);
    }
  }

  async function pushAll(replace: boolean) {
    if (!enabled) return;
    const eligible = visibleRows.filter((r) => r.acceptedCount > 0).map((r) => r.code);
    if (eligible.length === 0) {
      setStatus({
        busy: false,
        message: "No visible categories with accepted entries to push. Adjust the filter or search.",
        tone: "warn",
      });
      return;
    }
    const verb = replace ? "Replace" : "Push";
    const scopeLabel =
      eligible.length === localRows.length
        ? `${eligible.length} categories`
        : `${eligible.length} of ${localRows.length} categories (current view)`;
    const ok = await askConfirm({
      message: `${verb} ${scopeLabel} to Challonge${
        subdomain ? ` (subdomain ${subdomain})` : ""
      }? ${
        replace
          ? "Existing tournaments in 'pending' state will be deleted and recreated; non-pending will be skipped."
          : "Existing tournaments will be skipped (use Replace All to overwrite)."
      }`,
      confirmLabel: verb,
      tone: replace ? "warn" : "default",
    });
    if (!ok) return;
    setStatus({
      busy: true,
      message: `${verb}ing…`,
      tone: null,
      progress: { done: 0, total: eligible.length },
    });
    setBusyFor(null, null);
    try {
      const results = await runPerItem(
        eligible,
        (code) => ({ codes: [code], replace }),
        "POST",
        (done, total, latest, code) => {
          applyPushResult(code, latest);
          setStatus((s) => ({
            ...s,
            busy: true,
            message: `${verb}ing…`,
            progress: { done, total, latest: latest.code ?? code },
          }));
        },
      );
      setStatus(summarize(results, replace ? "replace" : "push"));
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    }
  }

  async function deleteAll() {
    if (!enabled) return;
    // "Delete all" deletes every pushed category in the CURRENT VIEW, plus
    // (only when the view is unfiltered) the orphans. Filtering changes the
    // scope so the operator can target a subset without nuking the whole
    // subdomain.
    const viewIsUnfiltered =
      visibleRows.length === localRows.length &&
      query.trim() === "" &&
      gender === "any" &&
      discipline === "any" &&
      arm === "any";
    const codes = visibleRows.filter((r) => r.pushed).map((r) => r.code);
    const slugs = viewIsUnfiltered ? localOrphans.map((o) => o.url) : [];
    const totalN = codes.length + slugs.length;
    if (totalN === 0) {
      setStatus({
        busy: false,
        message: viewIsUnfiltered
          ? "Nothing on Challonge to delete."
          : "No pushed categories in the current view.",
        tone: "warn",
      });
      return;
    }
    const breakdown =
      slugs.length > 0
        ? `${codes.length} category tournament${codes.length === 1 ? "" : "s"} + ${slugs.length} orphan${slugs.length === 1 ? "" : "s"}`
        : `${codes.length} tournament${codes.length === 1 ? "" : "s"}${
            viewIsUnfiltered ? "" : " (current view)"
          }`;
    const ok = await askConfirm({
      message: `Delete ALL ${totalN} tournaments under ${
        subdomain ? `${subdomain}.challonge.com` : "this account"
      } (${breakdown})? Cannot be undone.`,
      confirmLabel: `Delete ${totalN}`,
      tone: "danger",
    });
    if (!ok) return;
    setStatus({
      busy: true,
      message: `Deleting…`,
      tone: null,
      progress: { done: 0, total: totalN },
    });
    try {
      // One request per item — keeps each call well under the 300s function
      // timeout. Categories first, then orphans, sequentially.
      let combinedDone = 0;
      const onProg = (latest: ResultEntry, label: string) => {
        combinedDone += 1;
        setStatus((s) => ({
          ...s,
          busy: true,
          message: `Deleting…`,
          progress: {
            done: combinedDone,
            total: totalN,
            latest: latest.slug ?? latest.code ?? label,
          },
        }));
      };
      const all: ResultEntry[] = [];
      let aborted = false;
      if (codes.length > 0) {
        const r = await runPerItem(
          codes,
          (code) => ({ codes: [code] }),
          "DELETE",
          (_d, _t, latest, code) => {
            applyDeleteResult(code, latest);
            onProg(latest, code);
          },
        );
        all.push(...r);
        if (r.some((x) => !x.ok && !x.skipped)) aborted = true;
      }
      if (slugs.length > 0 && !aborted) {
        const r = await runPerItem(
          slugs,
          (slug) => ({ slugs: [slug] }),
          "DELETE",
          (_d, _t, latest, slug) => {
            applyOrphanDelete(slug, latest);
            onProg(latest, slug);
          },
        );
        all.push(...r);
      }
      setStatus(summarize(all, "delete"));
      router.refresh();
    } catch (e) {
      setStatus({ busy: false, message: (e as Error).message, tone: "error" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-2 border-ink p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code or label…"
          className="min-w-[200px] flex-1 border-2 border-ink px-2 py-1 font-mono text-xs"
        />
        <div className="inline-flex border-2 border-ink font-mono text-[11px] uppercase tracking-wide">
          {(
            [
              ["all", "All"],
              ["with-entries", "With entries"],
              ["unpushed", "Not pushed"],
              ["pushed", "Pushed"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`border-l-2 border-ink px-2 py-1 first:border-l-0 ${
                filter === key ? "bg-ink text-bone" : "hover:bg-ink/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-ink/60">
          {visibleRows.length} of {localRows.length} shown
        </span>
        {(query ||
          filter !== "all" ||
          gender !== "any" ||
          discipline !== "any" ||
          arm !== "any") && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilter("all");
              setGender("any");
              setDiscipline("any");
              setArm("any");
            }}
            className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-wide hover:bg-ink hover:text-paper"
          >
            Clear
          </button>
        )}
        <div className="flex w-full flex-wrap items-center gap-3 border-t border-ink/30 pt-2">
          <FilterGroup
            label="Gender"
            value={gender}
            options={[
              ["any", "Any"],
              ["men", "Men"],
              ["women", "Women"],
            ]}
            onChange={setGender}
          />
          <FilterGroup
            label="Discipline"
            value={discipline}
            options={[
              ["any", "Any"],
              ["nonpara", "Non-para"],
              ["para", "Para"],
            ]}
            onChange={setDiscipline}
          />
          <FilterGroup
            label="Arm"
            value={arm}
            options={[
              ["any", "Any"],
              ["L", "Left"],
              ["R", "Right"],
            ]}
            onChange={setArm}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!enabled || status.busy}
          onClick={() => pushAll(false)}
          className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-bone hover:bg-bone hover:text-ink disabled:opacity-40"
        >
          Push {visibleRows.length === localRows.length ? "all" : `view (${visibleRows.filter((r) => r.acceptedCount > 0).length})`}
        </button>
        <button
          type="button"
          disabled={!enabled || status.busy}
          onClick={() => pushAll(true)}
          className="border-2 border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          Replace {visibleRows.length === localRows.length ? "all" : "view"}
        </button>
        <button
          type="button"
          disabled={!enabled || status.busy}
          onClick={deleteAll}
          title={
            visibleRows.length === localRows.length && localOrphans.length > 0
              ? `Wipe the entire subdomain — ${localRows.filter((r) => r.pushed).length} category tournaments + ${localOrphans.length} orphans.`
              : `Delete ${visibleRows.filter((r) => r.pushed).length} pushed tournament(s) in the current view.`
          }
          className="border-2 border-red-700 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-40"
        >
          {visibleRows.length === localRows.length
            ? `Delete all${localOrphans.length > 0 ? ` (+${localOrphans.length} orphans)` : ""}`
            : `Delete view (${visibleRows.filter((r) => r.pushed).length})`}
        </button>
      </div>

      {status.message && (
        <div
          className={`space-y-1 border-2 px-3 py-2 font-mono text-xs ${
            status.tone ? TONE_CLASS[status.tone] : "border-ink bg-bone text-ink"
          }`}
        >
          <p>
            {status.message}
            {status.progress && (
              <span className="ml-2 opacity-80">
                {status.progress.done} / {status.progress.total}
                {status.progress.latest ? ` · ${status.progress.latest}` : ""}
              </span>
            )}
          </p>
          {status.progress && status.progress.total > 0 && (
            <div className="h-1 w-full border border-current/30 bg-current/10">
              <div
                className="h-full bg-current/60 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((status.progress.done / status.progress.total) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full font-mono text-sm">
          <thead className="bg-ink text-paper">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-right">Accepted</th>
              <th className="px-3 py-2 text-left">Challonge</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink/60">
                  {localRows.length === 0 ? "No categories with entries." : "No categories match the current filter."}
                </td>
              </tr>
            )}
            {visibleRows.map((r) => {
              const busy = perCode.get(r.code);
              const canPush = enabled && r.acceptedCount > 0;
              const canDelete = enabled && r.pushed;
              return (
                <tr key={r.code} className="border-t border-ink/20 align-middle">
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/events/${eventSlug}/categories/${encodeURIComponent(r.code)}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.code}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-ink/80">{r.label}</td>
                  <td className="px-3 py-2 text-right">
                    {r.acceptedCount > 0 ? (
                      r.acceptedCount
                    ) : (
                      <span className="text-ink/40">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.pushed && r.challongeUrl ? (
                      <a
                        href={r.challongeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-green-800 underline-offset-2 hover:underline"
                        title={`State: ${r.challongeState ?? "unknown"} · ${r.pushedParticipants} participants`}
                      >
                        ↗ pushed ({r.pushedParticipants})
                        {r.challongeState && r.challongeState !== "pending" && (
                          <span className="ml-1 text-[10px] uppercase text-amber-700">
                            · {r.challongeState}
                          </span>
                        )}
                      </a>
                    ) : (
                      <span className="text-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      {!r.pushed && (
                        <button
                          type="button"
                          onClick={() => pushOne(r.code, false)}
                          disabled={!canPush || !!busy || status.busy}
                          className="border-2 border-ink px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-40"
                        >
                          {busy === "push" ? "…" : "Push"}
                        </button>
                      )}
                      {r.pushed && (
                        <button
                          type="button"
                          onClick={() => pushOne(r.code, true)}
                          disabled={!canPush || !!busy || status.busy}
                          className="border-2 border-ink px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-ink hover:text-paper disabled:opacity-40"
                        >
                          {busy === "push" ? "…" : "Replace"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteOne(r.code)}
                        disabled={!canDelete || !!busy || status.busy}
                        className="border-2 border-red-700 px-2 py-1 text-[10px] uppercase tracking-wide text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-40"
                      >
                        {busy === "delete" ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {localOrphans.length > 0 && (
        <div className="space-y-2 border-2 border-amber-700 bg-amber-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-black text-amber-900">
                Orphan tournaments on Challonge ({localOrphans.length})
              </h3>
              <p className="font-mono text-[11px] text-amber-900/80">
                These exist under {subdomain ? `${subdomain}.challonge.com` : "your account"} but
                don&apos;t map to any current category code. Usually leftovers from a renamed
                category or a slug-format change. Safe to delete.
              </p>
            </div>
            <button
              type="button"
              disabled={!enabled || status.busy}
              onClick={deleteAllOrphans}
              className="border-2 border-red-700 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-40"
            >
              Delete all orphans
            </button>
          </div>
          <div className="overflow-x-auto border border-amber-700/50 bg-paper">
            <table className="w-full font-mono text-xs">
              <thead className="bg-amber-900/10 text-amber-900">
                <tr>
                  <th className="px-2 py-1 text-left">Slug</th>
                  <th className="px-2 py-1 text-left">State</th>
                  <th className="px-2 py-1 text-right">Participants</th>
                  <th className="px-2 py-1 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {localOrphans.map((o) => {
                  const busy = orphanBusy.has(o.url);
                  return (
                    <tr key={o.url} className="border-t border-amber-700/20">
                      <td className="px-2 py-1">
                        <a
                          href={o.fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          {o.url} ↗
                        </a>
                      </td>
                      <td className="px-2 py-1">{o.state}</td>
                      <td className="px-2 py-1 text-right">{o.participants}</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => deleteOrphan(o.url)}
                          disabled={!enabled || busy || status.busy}
                          className="border-2 border-red-700 px-2 py-1 text-[10px] uppercase tracking-wide text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-40"
                        >
                          {busy ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-ink/60">{label}:</span>
      <div className="inline-flex border-2 border-ink font-mono text-[10px] uppercase tracking-wide">
        {options.map(([key, optLabel]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`border-l-2 border-ink px-2 py-0.5 first:border-l-0 ${
              value === key ? "bg-ink text-bone" : "hover:bg-ink/10"
            }`}
          >
            {optLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
