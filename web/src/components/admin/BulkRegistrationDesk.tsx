"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  validateRegistration,
  eligibleNonParaClasses,
  eligibleParaCategories,
  ageOnMatchDay,
  type Hand,
} from "@/lib/rules/registration-rules";
import CameraCapture from "./CameraCapture";
import { useConfirm } from "@/components/ConfirmDialog";
import Spinner from "@/components/Spinner";
import { loadPendingRows, savePendingRows } from "./bulkPendingStore";

// Feature flag — counter desk currently doesn't ask the operator for a UTR or
// payment-proof image (offline cash/UPI is taken on trust at the counter).
// Flip to `true` to re-enable the UTR field, the proof-capture block, and
// the "no UTR/proof needed" hint without touching any other code path.
const SHOW_UPI_PROOF_UI = false;

export interface SavedRow {
  id: string;
  full_name: string | null;
  initial: string | null;
  chest_no: number | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  weight_class_code: string | null;
  payment_status?: string | null;
  paid_amount_inr?: number | null;
  total_fee_inr?: number | null;
  collected_inr?: number | null;
  remaining_inr?: number | null;
  /** 'not_arrived' | 'weighed_in' | 'no_show' — orthogonal to payment. */
  checkin_status?: "not_arrived" | "weighed_in" | "no_show" | null;
  /** 'active' | 'withdrawn' | 'disqualified' — only shown when not active. */
  lifecycle?: "active" | "withdrawn" | "disqualified" | null;
  /** @deprecated kept for back-compat with optimistic rows; derived from checkin_status server-side. */
  approved: boolean;
  saved_at: number;
  // Optimistic-sync metadata. Existing (server-loaded) rows omit these.
  client_id?: string;
  status?: "syncing" | "saved" | "error";
  error?: string;
  // Snapshot of the POST body so we can retry on error without
  // re-typing the whole form.
  payload?: Record<string, unknown>;
}

type DraftMode = "nonpara" | "para";

interface Draft {
  full_name: string;
  initial: string;
  // DOB split for fast typing.
  dob_d: string;
  dob_m: string;
  dob_y: string;
  gender: "" | "M" | "F";
  affiliation_kind: "District" | "Team";
  district: string;
  team: string;
  mobile: string;
  aadhaar: string;
  declared_weight_kg: string;

  mode: DraftMode;

  // Non-para: primary class with hand, optional Senior add-on with own hand.
  primary_class: string;
  primary_hand: "" | Hand;
  also_senior: boolean;
  senior_hand: "" | Hand;

  // Para: single category + single hand.
  para_code: string;
  para_hand: "" | Hand;

  paid_amount_inr: string;
  paid_touched: boolean;
  // Operator-editable total fee. Defaults to entries × event fee but the
  // operator can lower it; the difference shows up as an implicit waiver.
  total_fee_inr: string;
  total_touched: boolean;
  payment_method: "manual_upi" | "cash";
  payment_utr: string;

  /** Whether this row is online (athlete pre-registered) or offline
   *  (walk-in at the counter). Drives which event fee is the default. */
  channel: "online" | "offline";

  approve_weighin: boolean;

  photo_key: string | null;
  photo_preview: string | null;
  photo_uploading: boolean;

  proof_key: string | null;
  proof_preview: string | null;
  proof_uploading: boolean;
}

function emptyDraft(
  defaultFee: number,
  defaultMethod: "manual_upi" | "cash" = "manual_upi",
  channel: "online" | "offline" = "offline"
): Draft {
  return {
    full_name: "",
    initial: "",
    dob_d: "",
    dob_m: "",
    dob_y: "",
    gender: "",
    affiliation_kind: "District",
    district: "",
    team: "",
    mobile: "",
    aadhaar: "",
    declared_weight_kg: "",
    mode: "nonpara",
    primary_class: "",
    primary_hand: "",
    also_senior: false,
    senior_hand: "",
    para_code: "",
    para_hand: "",
    paid_amount_inr: String(defaultFee),
    paid_touched: false,
    total_fee_inr: String(defaultFee),
    total_touched: false,
    payment_method: defaultMethod,
    payment_utr: "",
    channel,
    approve_weighin: false,
    photo_key: null,
    photo_preview: null,
    photo_uploading: false,
    proof_key: null,
    proof_preview: null,
    proof_uploading: false,
  };
}

function pad2(s: string) {
  return s.length === 1 ? "0" + s : s;
}
function dobIso(d: Draft): string | null {
  if (!d.dob_d || !d.dob_m || d.dob_y.length !== 4) return null;
  const day = Number(d.dob_d);
  const mo = Number(d.dob_m);
  const yr = Number(d.dob_y);
  if (!day || !mo || !yr) return null;
  if (day < 1 || day > 31 || mo < 1 || mo > 12) return null;
  if (yr < 1900 || yr > 2030) return null;
  return `${yr}-${pad2(d.dob_m)}-${pad2(d.dob_d)}`;
}

export default function BulkRegistrationDesk({
  eventId,
  eventStartsAt,
  defaultFee,
  offlineFee,
  paymentMode = "online_upi",
  districts,
  initialSaved,
}: {
  eventId: string;
  eventStartsAt: string;
  /** Per-hand fee for online registrations (event.entry_fee_default_inr). */
  defaultFee: number;
  /** Per-hand fee for offline registrations. Falls back to defaultFee. */
  offlineFee?: number;
  paymentMode?: "online_upi" | "offline" | "hybrid";
  districts: readonly string[];
  initialSaved: SavedRow[];
}) {
  const confirm = useConfirm();
  const defaultMethod: "manual_upi" | "cash" =
    paymentMode === "offline" ? "cash" : "manual_upi";
  const effectiveOfflineFee = offlineFee ?? defaultFee;
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(effectiveOfflineFee, defaultMethod, "offline")
  );
  const [error, setError] = useState<string | null>(null);
  // Hydrate from localStorage so a refresh during a flaky-network event
  // doesn't lose typed athletes. Persisted rows are tagged status="error"
  // and live above the server-loaded list, ready for one-click retry.
  // De-dupes against `initialSaved` by client_id (already-server-saved
  // rows are dropped from the persisted set on success, but defend
  // against a stale entry surviving a missed cleanup).
  const [saved, setSaved] = useState<SavedRow[]>(() => {
    if (typeof window === "undefined") return initialSaved;
    const persisted = loadPendingRows(eventId);
    if (persisted.length === 0) return initialSaved;
    const seenIds = new Set(initialSaved.map((r) => r.id));
    const seenClientIds = new Set(
      initialSaved.map((r) => r.client_id).filter(Boolean)
    );
    const fresh = persisted.filter(
      (r) =>
        !seenIds.has(r.id) &&
        (!r.client_id || !seenClientIds.has(r.client_id))
    );
    return [...fresh, ...initialSaved];
  });
  const [cam, setCam] = useState<null | "photo" | "proof">(null);
  // When set, the form is editing an existing optimistic row. Save will
  // replace it (DELETE old + POST new) instead of appending.
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  // Right-rail search + filters. Empty query → most recent registrations
  // for the event. Non-empty → server-side filter across name / chest /
  // mobile / district / team. Status chips stack on top. Session rows
  // added during this mount stay pinned at the top regardless of filter.
  const [query, setQuery] = useState("");
  const [payFilter, setPayFilter] = useState<"" | "paid" | "non-paid">("");
  const [checkinFilter, setCheckinFilter] = useState<
    "" | "weighed-in" | "not-weighed-in"
  >("");
  const [searching, setSearching] = useState(false);
  const [eventTotal, setEventTotal] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch the right-rail list. Debounced so typing doesn't fire per
  // keystroke. Server-loaded rows are tagged with `saved_at: 0`; session
  // rows from a fresh save carry the real Date.now() — that's how we
  // tell them apart and avoid clobbering in-flight optimistic work.
  useEffect(() => {
    if (initialSaved.length > 0 && !query && !payFilter && !checkinFilter) return;
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(
      () => {
        const sp = new URLSearchParams({
          event_id: eventId,
          limit: "50",
        });
        if (query.trim()) sp.set("q", query.trim());
        if (payFilter) sp.set("pay", payFilter);
        if (checkinFilter) sp.set("checkin", checkinFilter);
        fetch(`/api/admin/registrations/recent-bulk?${sp.toString()}`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (cancelled) return;
            setSearching(false);
            if (!j?.rows) return;
            if (typeof j.total === "number") setEventTotal(j.total);
            setSaved((prev) => {
              const sessionRows = prev.filter((r) => (r.saved_at ?? 0) > 0);
              const sessionIds = new Set(sessionRows.map((r) => r.id));
              const fetched = (j.rows as SavedRow[]).filter(
                (r) => !sessionIds.has(r.id)
              );
              return [...sessionRows, ...fetched];
            });
          })
          .catch(() => {
            if (!cancelled) setSearching(false);
          });
      },
      query ? 220 : 0
    );
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [eventId, query, payFilter, checkinFilter, initialSaved.length]);

  // Global hotkey: "/" or Ctrl/Cmd+K focuses the right-rail search.
  // Skip when the user is already typing in another input/textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
  }, []);

  // ── Pending image uploads (decoupled from the row submit) ──────────
  // Uploads are tied to a *draft session* via `draftIdRef`. When the
  // operator clicks Save & Next we hand the in-flight upload promise to
  // `submitRow`, which awaits it and merges the resolved storage key
  // into the body before POSTing. That way the form is never blocked
  // by a slow camera upload — typing the next athlete continues while
  // the previous row's photo is still travelling to S3.
  const draftIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `draft-${Date.now()}`
  );
  type PendingUpload = {
    photo?: Promise<string | null>;
    proof?: Promise<string | null>;
  };
  const pendingUploadsRef = useRef<Map<string, PendingUpload>>(new Map());
  const newDraftId = useCallback(() => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    draftIdRef.current = id;
    return id;
  }, []);

  // ── Eligibility (purely local, instant feedback) ─────────────────────
  const dob = dobIso(draft);
  const age = useMemo(() => {
    if (!dob) return null;
    return ageOnMatchDay(dob, eventStartsAt);
  }, [dob, eventStartsAt]);

  const allowedNonPara = useMemo(() => {
    if (!draft.gender || !dob || age === null) return [];
    return eligibleNonParaClasses(draft.gender, age);
  }, [draft.gender, dob, age]);

  const allowedPara = useMemo(() => {
    if (!draft.gender || !dob || age === null) return [];
    return eligibleParaCategories(draft.gender, age);
  }, [draft.gender, dob, age]);

  // Toggle "also Senior" availability: athletes 16+ can opt into Senior.
  const seniorAddOnAvailable = useMemo(() => {
    if (!age || age < 16) return false;
    if (draft.mode !== "nonpara") return false;
    if (!draft.primary_class) return false;
    if (draft.primary_class === "SENIOR") return false;
    return true;
  }, [age, draft.mode, draft.primary_class]);

  // Drop incompatible selections when prerequisites change.
  useEffect(() => {
    if (draft.mode !== "nonpara") return;
    if (!draft.primary_class) return;
    if (!allowedNonPara.find((c) => c.className === draft.primary_class)) {
      patch({ primary_class: "", primary_hand: "" });
    }
  }, [allowedNonPara, draft.mode, draft.primary_class, patch]);

  useEffect(() => {
    if (!seniorAddOnAvailable && (draft.also_senior || draft.senior_hand)) {
      patch({ also_senior: false, senior_hand: "" });
    }
  }, [seniorAddOnAvailable, draft.also_senior, draft.senior_hand, patch]);

  useEffect(() => {
    if (draft.mode !== "para") return;
    if (!draft.para_code) return;
    if (!allowedPara.find((c) => c.code === draft.para_code)) {
      patch({ para_code: "" });
    }
  }, [allowedPara, draft.mode, draft.para_code, patch]);

  // ── Fee math ──────────────────────────────────────────────────────
  // One entry = one (class, hand) pair. Hand "B" (Both) counts as
  // two entries (R + L). Senior add-on with its own hand adds another
  // entry (or two, if Senior hand is also B).
  const handEntries = (h: "" | Hand) => (h === "B" ? 2 : h ? 1 : 0);
  const entryCount = useMemo(() => {
    if (draft.mode === "nonpara") {
      let n = draft.primary_class ? handEntries(draft.primary_hand) : 0;
      if (draft.also_senior) n += handEntries(draft.senior_hand);
      return n;
    }
    return draft.para_code ? handEntries(draft.para_hand) : 0;
  }, [
    draft.mode,
    draft.primary_class,
    draft.primary_hand,
    draft.also_senior,
    draft.senior_hand,
    draft.para_code,
    draft.para_hand,
  ]);

  // Suggested total = entries × per-hand fee for the selected channel.
  // Online and offline registrations may use different per-hand rates.
  const perHandFee = draft.channel === "online" ? defaultFee : effectiveOfflineFee;
  const suggestedTotal = Math.max(entryCount, 1) * perHandFee;
  const totalFee = Math.max(0, Number(draft.total_fee_inr) || 0);
  const paidNum = Number(draft.paid_amount_inr) || 0;
  const pendingFee = Math.max(0, totalFee - paidNum);
  // Anything we lopped off the suggested total is a waiver — surfaced in
  // the UI so the operator sees what they're discounting.
  const waivedFee = Math.max(0, suggestedTotal - totalFee);
  // Verified once paid covers the (edited) total. ₹0 totals are
  // implicitly verified — they mean "fully waived, nothing to collect".
  const derivedPaymentStatus: "pending" | "verified" =
    totalFee === 0 || paidNum >= totalFee ? "verified" : "pending";

  // Auto-sync the Total field to the suggested figure until the operator
  // edits it manually — keeps the common case zero-friction.
  useEffect(() => {
    if (draft.total_touched) return;
    const next = String(suggestedTotal);
    if (draft.total_fee_inr !== next) patch({ total_fee_inr: next });
  }, [suggestedTotal, draft.total_touched, draft.total_fee_inr, patch]);

  // Auto-sync the Paid field to the (current) total until the operator
  // edits it manually — keeps typing fast for the common case.
  useEffect(() => {
    if (draft.paid_touched) return;
    const next = String(totalFee);
    if (draft.paid_amount_inr !== next) patch({ paid_amount_inr: next });
  }, [totalFee, draft.paid_touched, draft.paid_amount_inr, patch]);

  // If the operator lowered the total below what was already entered as
  // paid, clamp paid down so we never display "₹500 of ₹300".
  useEffect(() => {
    if (paidNum > totalFee) {
      patch({ paid_amount_inr: String(totalFee), paid_touched: true });
    }
  }, [paidNum, totalFee, patch]);

  // ── Photo / proof upload (background, doesn't block typing) ──────────
  // Returns void; the actual upload promise is parked on
  // `pendingUploadsRef` keyed by the current draftId so `save` can hand
  // it to `submitRow` without waiting for it inline.
  const upload = useCallback(
    (kind: "photo" | "proof", blob: Blob) => {
      const previewUrl = URL.createObjectURL(blob);
      const draftId = draftIdRef.current;
      patch(
        kind === "photo"
          ? { photo_uploading: true, photo_preview: previewUrl, photo_key: null }
          : { proof_uploading: true, proof_preview: previewUrl, proof_key: null }
      );
      const promise: Promise<string | null> = (async () => {
        try {
          const form = new FormData();
          form.append(
            "file",
            new File([blob], `${kind}-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" })
          );
          form.append("purpose", kind === "photo" ? "reg-photo" : "payment-proof");
          form.append("event_id", eventId);
          const res = await fetch("/api/upload", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "upload failed");
          // Only patch draft state if the operator hasn't moved on yet.
          // After Save & Next the draftId changes; the current draft
          // shouldn't suddenly flip to "uploaded" for a previous shot.
          if (draftIdRef.current === draftId) {
            patch(
              kind === "photo"
                ? { photo_uploading: false, photo_key: data.key }
                : { proof_uploading: false, proof_key: data.key }
            );
          }
          return data.key as string;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "upload failed";
          console.error("[bulk-desk] upload", kind, msg);
          if (draftIdRef.current === draftId) {
            patch(
              kind === "photo"
                ? { photo_uploading: false, photo_preview: null }
                : { proof_uploading: false, proof_preview: null }
            );
            setError(`${kind} upload: ${msg}`);
          }
          return null;
        }
      })();
      const slot = pendingUploadsRef.current.get(draftId) ?? {};
      slot[kind] = promise;
      pendingUploadsRef.current.set(draftId, slot);
    },
    [eventId, patch]
  );

  // ── Background submit ───────────────────────────────────────────────
  // Fire-and-forget POST. Updates the matching optimistic row on settle.
  // If `pending` is supplied, awaits the in-flight image uploads first
  // and merges their resolved storage keys into the body before POSTing.
  const submitRow = useCallback(
    async (
      clientId: string,
      body: Record<string, unknown>,
      pending?: PendingUpload
    ) => {
      let merged = body;
      if (pending && (pending.photo || pending.proof)) {
        const [photoKey, proofKey] = await Promise.all([
          pending.photo ?? Promise.resolve<string | null>(null),
          pending.proof ?? Promise.resolve<string | null>(null),
        ]);
        if (photoKey || proofKey) {
          merged = { ...body };
          if (photoKey) merged.photo_key = photoKey;
          // Proof is only meaningful for manual_upi rows; matches save().
          if (proofKey && merged.payment_method === "manual_upi") {
            merged.payment_proof_key = proofKey;
          }
          // Keep the optimistic row's snapshot in sync so retry uses the
          // resolved keys (otherwise a retry after the upload finished
          // would still POST the original null-key payload).
          setSaved((rs) =>
            rs.map((r) =>
              r.client_id === clientId ? { ...r, payload: merged } : r
            )
          );
        }
      }
      try {
        const res = await fetch("/api/admin/registrations/bulk-row", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(merged),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSaved((rs) =>
          rs.map((r) =>
            r.client_id === clientId
              ? {
                  ...r,
                  id: data.id ?? r.id,
                  chest_no: data.chest_no ?? r.chest_no,
                  status: "saved",
                  error: undefined,
                  // Keep payload so the row can be edited again.
                }
              : r
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "save failed";
        setSaved((rs) =>
          rs.map((r) =>
            r.client_id === clientId
              ? { ...r, status: "error", error: msg, payload: merged }
              : r
          )
        );
      }
    },
    []
  );

  const retryRow = useCallback(
    (clientId: string) => {
      setSaved((rs) =>
        rs.map((r) =>
          r.client_id === clientId
            ? { ...r, status: "syncing", error: undefined }
            : r
        )
      );
      const row = savedRef.current.find((r) => r.client_id === clientId);
      if (row?.payload) void submitRow(clientId, row.payload);
    },
    [submitRow]
  );

  // ── Load a saved row back into the form for editing ─────────────────
  const loadRow = useCallback(
    async (clientId: string) => {
      const row = savedRef.current.find((r) => r.client_id === clientId);
      if (!row) return;

      let payload = row.payload as Record<string, unknown> | undefined;

      // Server-loaded rows (and any row whose payload was dropped) need
      // a fetch to hydrate the full form state. We use the registration
      // GET endpoint which returns a bulk-row-shaped payload.
      // NOTE: server-loaded rows from /recent-bulk have client_id === id,
      // so we can't use that as the discriminator — having a real server
      // id and no payload is enough.
      if (!payload && row.id) {
        setSaved((rs) =>
          rs.map((r) =>
            r.client_id === clientId ? { ...r, status: "syncing" } : r
          )
        );
        try {
          // ?reveal=aadhaar opts in to the unmasked Aadhaar (audit-logged
          // server-side, no-store response). Without this the response
          // would only carry the masked form and Edit would lose the field.
          const res = await fetch(
            `/api/admin/registrations/${row.id}?reveal=aadhaar`,
            { cache: "no-store" }
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j = (await res.json()) as { payload: Record<string, unknown> };
          payload = j.payload;
          setSaved((rs) =>
            rs.map((r) =>
              r.client_id === clientId
                ? { ...r, status: "saved", payload }
                : r
            )
          );
        } catch (err) {
          setSaved((rs) =>
            rs.map((r) =>
              r.client_id === clientId ? { ...r, status: "saved" } : r
            )
          );
          setError(err instanceof Error ? err.message : "failed to load row");
          return;
        }
      }

      if (!payload) {
        setError("can't edit this row — no data available");
        return;
      }

      const p = payload;
      const dobStr = (p.dob as string | undefined) ?? "";
      const [yy, mm, dd] = dobStr ? dobStr.split("-") : ["", "", ""];
      const nonparaClasses = (p.nonpara_classes as string[] | undefined) ?? [];
      const nonparaHands =
        (p.nonpara_hands as Record<string, Hand> | undefined) ?? {};
      const paraCodes = (p.para_codes as string[] | undefined) ?? [];
      const isPara = paraCodes.length > 0;
      // SENIOR is treated as an "add-on" only when there's another class
      // alongside it (compete-up case). For adult athletes whose only class
      // is SENIOR, it IS the primary class.
      const hasNonSeniorClass = nonparaClasses.some((c) => c !== "SENIOR");
      const alsoSenior =
        hasNonSeniorClass && nonparaClasses.includes("SENIOR");
      const primaryClass = hasNonSeniorClass
        ? nonparaClasses.find((c) => c !== "SENIOR") ?? ""
        : nonparaClasses[0] ?? "";
      const primaryHand =
        (nonparaHands[primaryClass] as Hand) ??
        (nonparaClasses[0]
          ? (nonparaHands[nonparaClasses[0]] as Hand)
          : "") ??
        "";
      const fresh: Draft = {
        full_name: (p.full_name as string) ?? "",
        initial: (p.initial as string) ?? "",
        dob_d: dd ?? "",
        dob_m: mm ?? "",
        dob_y: yy ?? "",
        gender: (p.gender as "M" | "F") ?? "",
        affiliation_kind:
          ((p.affiliation_kind as "District" | "Team") ?? "District"),
        district: (p.district as string) ?? "",
        team: (p.team as string) ?? "",
        mobile: (p.mobile as string) ?? "",
        aadhaar: (p.aadhaar as string) ?? "",
        declared_weight_kg: String(p.declared_weight_kg ?? ""),
        mode: isPara ? "para" : "nonpara",
        primary_class: primaryClass,
        primary_hand: primaryHand,
        also_senior: alsoSenior,
        senior_hand: (nonparaHands["SENIOR"] as Hand) ?? "",
        para_code: paraCodes[0] ?? "",
        para_hand: (p.para_hand as Hand) ?? "",
        paid_amount_inr: String(p.paid_amount_inr ?? 0),
        paid_touched: true,
        total_fee_inr: String(p.total_fee_inr ?? p.paid_amount_inr ?? 0),
        total_touched: true,
        payment_method:
          p.payment_method === "manual_upi" || p.payment_method === "cash"
            ? p.payment_method
            : defaultMethod,
        payment_utr: (p.payment_utr as string) ?? "",
        channel: p.channel === "online" ? "online" : "offline",
        approve_weighin: Boolean(p.approve_weighin),
        photo_key: (p.photo_key as string) ?? null,
        photo_preview: null,
        photo_uploading: false,
        proof_key: (p.payment_proof_key as string) ?? null,
        proof_preview: null,
        proof_uploading: false,
      };
      // Loading a row starts a fresh draft session — discard any leftover
      // pending uploads so the next capture is the one that gets attached.
      newDraftId();
      setDraft(fresh);
      setEditingClientId(clientId);
      setError(null);
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    [defaultMethod, newDraftId]
  );

  const cancelEdit = useCallback(() => {
    setEditingClientId(null);
    newDraftId();
    setDraft(emptyDraft(effectiveOfflineFee, defaultMethod, "offline"));
    setError(null);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [effectiveOfflineFee, defaultMethod, newDraftId]);

  // ── Delete a row ────────────────────────────────────────────────────
  const deleteRow = useCallback(
    async (clientId: string) => {
      const row = savedRef.current.find((r) => r.client_id === clientId);
      if (!row) return;
      // Optimistic remove. Cancel edit if we were editing this row.
      setSaved((rs) => rs.filter((r) => r.client_id !== clientId));
      if (editingClientId === clientId) {
        setEditingClientId(null);
        setDraft(emptyDraft(effectiveOfflineFee, defaultMethod, "offline"));
      }
      // Server-persisted rows need a DELETE call. status === "saved"
      // means the server round-trip completed (or the row came in via
      // /recent-bulk to begin with), so `row.id` is a real DB uuid we
      // can target. Optimistic "syncing" rows are local-only.
      if (row.status === "saved" && row.id) {
        try {
          const res = await fetch(`/api/admin/registrations/${row.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          // Restore the row on failure so nothing silently disappears.
          setSaved((rs) => [{ ...row, status: "error", error: "delete failed" }, ...rs]);
          setError(err instanceof Error ? err.message : "delete failed");
        }
      }
    },
    [defaultFee, editingClientId]
  );

  // ── Save current draft (instant, optimistic) ────────────────────────
  const save = useCallback(() => {
    setError(null);

    // ── Strict client-side validation. The server runs the same checks,
    // but we want zero validation-driven failures once a row goes async. ──
    if (!draft.full_name.trim()) return setError("name required");
    if (!dob) return setError("date of birth required (DD MM YYYY)");
    if (!draft.gender) return setError("gender required");
    if (!/^\d{10}$/.test(draft.mobile)) return setError("mobile must be 10 digits");
    if (!/^\d{12}$/.test(draft.aadhaar)) {
      return setError("aadhaar must be 12 digits");
    }
    const weight = Number(draft.declared_weight_kg);
    if (!Number.isFinite(weight) || weight < 20 || weight > 250) {
      return setError("weight must be between 20 and 250 kg");
    }
    if (draft.affiliation_kind === "District") {
      if (!draft.district) return setError("district required");
      if (!districts.includes(draft.district)) {
        return setError("pick a district from the list");
      }
    }
    if (draft.affiliation_kind === "Team" && draft.team.trim().length < 2) {
      return setError("team name required");
    }
    // NOTE: we deliberately do NOT block on photo_uploading/proof_uploading.
    // The in-flight upload promise is parked on pendingUploadsRef and
    // handed to submitRow below, which awaits it before POSTing the row.

    let nonpara_classes: string[] = [];
    let nonpara_hands: Record<string, Hand> = {};
    let para_codes: string[] = [];
    let para_hand: Hand | null = null;
    let include_senior = false;

    if (draft.mode === "nonpara") {
      if (!draft.primary_class || !draft.primary_hand) {
        return setError("pick a class and a hand");
      }
      nonpara_classes = [draft.primary_class];
      nonpara_hands = { [draft.primary_class]: draft.primary_hand };
      if (draft.also_senior) {
        if (!draft.senior_hand) return setError("pick a hand for the Senior add-on");
        nonpara_classes.push("SENIOR");
        nonpara_hands["SENIOR"] = draft.senior_hand;
        if (age !== null && age < 23) include_senior = true;
      }
    } else {
      if (!draft.para_code || !draft.para_hand) return setError("pick a para category and a hand");
      para_codes = [draft.para_code];
      para_hand = draft.para_hand;
    }

    // Same rules the API uses — keep us in lockstep.
    const v = validateRegistration(
      {
        gender: draft.gender,
        dob,
        declaredWeightKg: weight,
        nonparaClasses: nonpara_classes,
        nonparaHands: nonpara_hands,
        includeSenior: include_senior,
        paraCodes: para_codes,
        paraHand: para_hand,
      },
      eventStartsAt
    );
    if (!v.ok) return setError(v.errors.join("; "));

    const body = {
      event_id: eventId,
      full_name: draft.full_name.trim(),
      initial: draft.initial.trim() || undefined,
      dob,
      gender: draft.gender,
      affiliation_kind: draft.affiliation_kind,
      district: draft.affiliation_kind === "District" ? draft.district : undefined,
      team: draft.affiliation_kind === "Team" ? draft.team.trim() : undefined,
      mobile: draft.mobile,
      aadhaar: draft.aadhaar.trim() || undefined,
      declared_weight_kg: weight,
      nonpara_classes,
      nonpara_hands,
      include_senior,
      para_codes,
      para_hand,
      photo_key: draft.photo_key ?? undefined,
      paid_amount_inr: Number(draft.paid_amount_inr) || 0,
      total_fee_inr: totalFee,
      payment_status: derivedPaymentStatus,
      payment_method: draft.payment_method,
      payment_utr: draft.payment_method === "manual_upi" ? draft.payment_utr.trim() || undefined : undefined,
      payment_proof_key: draft.payment_method === "manual_upi" ? draft.proof_key ?? undefined : undefined,
      approve_weighin: draft.approve_weighin,
      channel: draft.channel,
    };

    // Optimistic row — appears in the right rail instantly.
    const clientId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: SavedRow = {
      id: clientId,
      client_id: clientId,
      full_name: draft.full_name.trim(),
      initial: draft.initial.trim() || null,
      chest_no: null,
      district: draft.affiliation_kind === "District" ? draft.district : null,
      team: draft.affiliation_kind === "Team" ? draft.team.trim() : null,
      declared_weight_kg: weight,
      weight_class_code: null,
      payment_status: derivedPaymentStatus,
      paid_amount_inr: Number(draft.paid_amount_inr) || 0,
      approved: draft.approve_weighin,
      saved_at: Date.now(),
      status: "syncing",
      payload: body,
    };

    // Detach the in-flight uploads from the current draft session and
    // hand them off to the row submit. We rotate the draftId so any new
    // uploads from the next athlete go into a fresh slot.
    const handoffDraftId = draftIdRef.current;
    const pending = pendingUploadsRef.current.get(handoffDraftId);
    pendingUploadsRef.current.delete(handoffDraftId);
    newDraftId();

    if (editingClientId) {
      // ── Edit mode: replace the row in place + delete the old server row.
      const prev = savedRef.current.find(
        (r) => r.client_id === editingClientId
      );
      // Re-use the same client_id so the row stays in the same slot.
      optimistic.client_id = editingClientId;
      optimistic.id = prev?.id ?? editingClientId;
      setSaved((rs) =>
        rs.map((r) => (r.client_id === editingClientId ? optimistic : r))
      );
      // Background DELETE of the old server row (if any), then POST new.
      if (prev && prev.id && prev.status === "saved") {
        void fetch(`/api/admin/registrations/${prev.id}`, { method: "DELETE" })
          .catch(() => {
            // Don't surface — worst case the DELETE failed and the user
            // sees two rows for one athlete. Edit retry is still safe.
          });
      }
      setEditingClientId(null);
      void submitRow(editingClientId, body, pending);
    } else {
      setSaved((rs) => [optimistic, ...rs]);
      void submitRow(clientId, body, pending);
    }

    // Reset for next athlete — keep affiliation + district/team + fee
    // sticky (operators usually run one district at a time).
    const fresh = emptyDraft(effectiveOfflineFee, defaultMethod, draft.channel);
    fresh.affiliation_kind = draft.affiliation_kind;
    fresh.district = draft.district;
    fresh.team = draft.team;
    fresh.approve_weighin = draft.approve_weighin;
    fresh.payment_method = draft.payment_method;
    setDraft(fresh);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [effectiveOfflineFee, defaultMethod, derivedPaymentStatus, districts, dob, draft, editingClientId, eventId, eventStartsAt, newDraftId, submitRow]);

  // Keep latest saved list in a ref so retryRow can read the payload.
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Persist errored rows to localStorage whenever the set changes.
  // We only persist `"error"` rows — syncing rows could race the in-flight
  // POST and saved rows are already on the server. Effect runs cheaply
  // since serialized payload is small (~2 KB/row).
  useEffect(() => {
    const errored = saved.filter(
      (r) => r.status === "error" && r.client_id && r.payload
    );
    savePendingRows(eventId, errored);
  }, [saved, eventId]);

  // Retry every errored row in one click. Walks the snapshot so newly
  // added errors during the retry pass aren't double-fired.
  const retryAllErrors = useCallback(() => {
    const errored = savedRef.current.filter(
      (r) => r.status === "error" && r.client_id && r.payload
    );
    if (errored.length === 0) return;
    setSaved((rs) =>
      rs.map((r) =>
        r.status === "error" && r.client_id
          ? { ...r, status: "syncing", error: undefined }
          : r
      )
    );
    for (const r of errored) {
      void submitRow(r.client_id!, r.payload as Record<string, unknown>);
    }
  }, [submitRow]);

  // Drop every errored row from UI and storage. Used as the "give up"
  // escape hatch when the operator decides those rows aren't worth
  // recovering (e.g. duplicate of a row they already re-typed).
  const clearFailedRows = useCallback(() => {
    setSaved((rs) => rs.filter((r) => r.status !== "error"));
  }, []);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name on mount.
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Ctrl/Cmd+Enter to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
      {/* ── LEFT: form ──────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className={`space-y-4 border-2 bg-bone p-4 ${
          editingClientId ? "border-rust" : "border-ink"
        }`}
      >
        {editingClientId && (
          <div className="flex items-center justify-between gap-3 border-2 border-rust bg-rust/10 p-3">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-rust">
              Editing
              {(() => {
                const r = saved.find((x) => x.client_id === editingClientId);
                if (!r) return "";
                return r.chest_no ? ` · ${r.chest_no} ${r.full_name ?? ""}` : ` · ${r.full_name ?? ""}`;
              })()}
            </p>
            <button
              type="button"
              onClick={cancelEdit}
              className="border-2 border-rust px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
        {/* Identity */}
        <fieldset className="space-y-2">
          <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
            Identity
          </legend>
          <div className="flex gap-2">
            <Field label="Initial" w="w-16">
              <input
                value={draft.initial}
                onChange={(e) =>
                  patch({ initial: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3) })
                }
                placeholder="K"
                className={inputCls}
              />
            </Field>
            <Field label="Full name" grow>
              <input
                ref={nameInputRef}
                value={draft.full_name}
                onChange={(e) =>
                  patch({ full_name: e.target.value.replace(/[^A-Za-z ]/g, "").toUpperCase() })
                }
                placeholder="ATHLETE FULL NAME"
                className={inputCls}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Field label="DOB (DD MM YYYY)" w="w-52">
              <DobInput
                day={draft.dob_d}
                month={draft.dob_m}
                year={draft.dob_y}
                eventStartsAt={eventStartsAt}
                onChange={(d, m, y) =>
                  patch({ dob_d: d, dob_m: m, dob_y: y })
                }
                inputCls={inputCls}
              />
            </Field>

            <Field label="Gender" w="w-24">
              <div className="flex gap-1">
                {(["M", "F"] as const).map((g) => (
                  <button
                    type="button"
                    key={g}
                    onClick={() => patch({ gender: g })}
                    className={`h-9 flex-1 border-2 font-mono text-xs font-bold ${
                      draft.gender === g
                        ? "border-ink bg-ink text-bone"
                        : "border-ink/40 hover:border-ink"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Mobile" w="w-36">
              <input
                inputMode="numeric"
                value={draft.mobile}
                maxLength={10}
                onChange={(e) =>
                  patch({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })
                }
                placeholder="10 digits"
                className={`${inputCls} font-mono`}
              />
            </Field>

            <Field label="Aadhaar" w="w-40">
              <input
                inputMode="numeric"
                value={draft.aadhaar}
                maxLength={12}
                onChange={(e) =>
                  patch({ aadhaar: e.target.value.replace(/\D/g, "").slice(0, 12) })
                }
                placeholder="12 digits"
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>

          {age !== null && (
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              Age on match day: <span className="text-ink">{age}</span>
            </p>
          )}
        </fieldset>

        {/* Affiliation */}
        <fieldset className="space-y-2">
          <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
            Affiliation
          </legend>
          <div className="flex gap-2">
            {(["District", "Team"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => patch({ affiliation_kind: k })}
                className={`h-9 px-4 border-2 font-mono text-xs font-bold uppercase tracking-[0.2em] ${
                  draft.affiliation_kind === k
                    ? "border-ink bg-ink text-bone"
                    : "border-ink/40 hover:border-ink"
                }`}
              >
                {k}
              </button>
            ))}
            <div className="flex-1">
              {draft.affiliation_kind === "District" ? (
                <DistrictCombo
                  value={draft.district}
                  onChange={(v) => patch({ district: v })}
                  districts={districts}
                />
              ) : (
                <input
                  value={draft.team}
                  onChange={(e) => patch({ team: e.target.value })}
                  placeholder="Team name"
                  className={inputCls}
                />
              )}
            </div>
          </div>
        </fieldset>

        {/* Class + hand */}
        <fieldset className="space-y-2">
          <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
            Category
          </legend>

          <div className="flex flex-wrap items-end gap-2">
            {(["nonpara", "para"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  patch({
                    mode: m,
                    primary_class: "",
                    primary_hand: "",
                    also_senior: false,
                    senior_hand: "",
                    para_code: "",
                    para_hand: "",
                  })
                }
                className={`h-9 px-4 border-2 font-mono text-xs font-bold uppercase tracking-[0.2em] ${
                  draft.mode === m
                    ? "border-ink bg-ink text-bone"
                    : "border-ink/40 hover:border-ink"
                }`}
              >
                {m === "nonpara" ? "Non-para" : "Para"}
              </button>
            ))}
            <Field label="Weight (kg)" w="w-28">
              <input
                inputMode="decimal"
                value={draft.declared_weight_kg}
                onChange={(e) => {
                  // Digits + at most one dot. Strip everything else.
                  let v = e.target.value.replace(/[^\d.]/g, "");
                  const firstDot = v.indexOf(".");
                  if (firstDot !== -1) {
                    v =
                      v.slice(0, firstDot + 1) +
                      v.slice(firstDot + 1).replace(/\./g, "");
                    // Cap at one digit after the decimal.
                    v = v.slice(0, firstDot + 2);
                  }
                  patch({ declared_weight_kg: v });
                }}
                placeholder="kg"
                className={`${inputCls} text-right font-mono tabular-nums`}
              />
            </Field>
            <label
              className={`flex h-9 cursor-pointer items-center gap-2 border-2 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.15em] ${
                draft.approve_weighin
                  ? "border-moss bg-moss/10 text-moss"
                  : "border-ink/40 text-ink/70 hover:border-ink"
              }`}
              title="Mark weighed-in immediately (declared weight is correct)"
            >
              <input
                type="checkbox"
                checked={draft.approve_weighin}
                onChange={(e) => patch({ approve_weighin: e.target.checked })}
                className="h-4 w-4"
              />
              Weighed-in ✓
            </label>
          </div>

          {draft.mode === "nonpara" ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Field label="Class" w="w-56">
                  <select
                    value={draft.primary_class}
                    onChange={(e) => patch({ primary_class: e.target.value })}
                    disabled={allowedNonPara.length === 0}
                    className={`${inputCls} font-mono`}
                  >
                    <option value="">{allowedNonPara.length === 0 ? "set DOB + gender" : "–"}</option>
                    {allowedNonPara.map((c) => (
                      <option key={c.className} value={c.className}>
                        {c.className}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hand" w="w-48">
                  <HandPicker value={draft.primary_hand} onChange={(h) => patch({ primary_hand: h })} />
                </Field>
              </div>

              {seniorAddOnAvailable && (
                <div className="space-y-2 border border-ink/30 bg-kraft/10 p-3">
                  <label className="flex cursor-pointer items-center gap-2 font-mono text-xs">
                    <input
                      type="checkbox"
                      checked={draft.also_senior}
                      onChange={(e) =>
                        patch({ also_senior: e.target.checked, senior_hand: "" })
                      }
                    />
                    Also enter <b>SENIOR</b> (compete-up). Different hand allowed.
                  </label>
                  {draft.also_senior && (
                    <Field label="Senior hand" w="w-48">
                      <HandPicker
                        value={draft.senior_hand}
                        onChange={(h) => patch({ senior_hand: h })}
                      />
                    </Field>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Field label="Para category" w="w-72">
                  <select
                    value={draft.para_code}
                    onChange={(e) => patch({ para_code: e.target.value })}
                    disabled={allowedPara.length === 0}
                    className={`${inputCls} font-mono`}
                  >
                    <option value="">
                      {allowedPara.length === 0 ? "set DOB + gender" : "–"}
                    </option>
                    {Array.from(
                      allowedPara
                        .reduce((m, c) => {
                          const key = `${c.className} · ${c.posture}`;
                          if (!m.has(key)) m.set(key, []);
                          m.get(key)!.push(c);
                          return m;
                        }, new Map<string, typeof allowedPara>())
                        .entries()
                    ).map(([groupLabel, rows]) => (
                      <optgroup key={groupLabel} label={groupLabel}>
                        {rows.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} · age{" "}
                            {c.maxAge !== null
                              ? `${c.minAge}–${c.maxAge}`
                              : `${c.minAge}+`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="Hand" w="w-48">
                  <HandPicker
                    value={draft.para_hand}
                    onChange={(h) => patch({ para_hand: h })}
                  />
                </Field>
                {draft.para_code && (() => {
                  const sel = allowedPara.find((c) => c.code === draft.para_code);
                  if (!sel) return null;
                  return (
                    <div className="min-w-0 flex-1 self-end border border-ink/30 bg-kraft/10 px-2 py-1.5 font-mono text-[10px] leading-snug text-ink/70">
                      <span
                        className={`mr-1 inline-block border px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${
                          sel.posture === "Sitting"
                            ? "border-rust bg-rust/10 text-rust"
                            : "border-ink/40 text-ink/70"
                        }`}
                      >
                        {sel.posture}
                      </span>
                      <span className="text-ink">{sel.classFull}</span>
                      <span className="ml-1 text-ink/50">
                        · grid {sel.buckets.map((b) => b.label).join(", ")}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </fieldset>

        {/* Photo */}
        <fieldset className="space-y-1">
          <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
            Athlete photo
          </legend>
          <div className="flex items-center gap-3">
            {draft.photo_preview ? (
              <img
                src={draft.photo_preview}
                alt="athlete"
                className="h-16 w-14 border-2 border-ink object-cover"
              />
            ) : (
              <div className="flex h-16 w-14 items-center justify-center border-2 border-dashed border-ink/40 font-mono text-[9px] uppercase text-ink/40">
                no photo
              </div>
            )}
            <button
              type="button"
              onClick={() => setCam("photo")}
              className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust"
            >
              📷 capture
            </button>
            <FileFallback
              onPick={(b) => upload("photo", b)}
              label="📁 file"
              accept="image/*"
            />
            {draft.photo_uploading && (
              <Spinner variant="inline" label="Uploading" />
            )}
            {draft.photo_key && !draft.photo_uploading && (
              <span className="font-mono text-[10px] uppercase text-moss">✓ ready</span>
            )}
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.2em] text-ink/40">
              optional
            </span>
          </div>
        </fieldset>

        {/* Payment */}
        <fieldset className="space-y-2">
          <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
            Payment
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              Channel:
            </span>
            {(
              [
                { value: "offline", label: "Offline", fee: effectiveOfflineFee },
                { value: "online", label: "Online", fee: defaultFee },
              ] as const
            ).map((c) => {
              const active = draft.channel === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() =>
                    patch({
                      channel: c.value,
                      // Re-arm auto-sync of total when the operator hasn't
                      // edited it manually, so the fee follows the channel.
                      total_touched: draft.total_touched,
                    })
                  }
                  className={`h-8 border-2 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] ${
                    active ? "border-ink bg-ink text-bone" : "border-ink/40 hover:border-ink"
                  }`}
                  title={`Per-hand fee ₹${c.fee}`}
                >
                  {c.label}
                </button>
              );
            })}
            {effectiveOfflineFee !== defaultFee && (
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
                ₹{effectiveOfflineFee} desk · ₹{defaultFee} online
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              Method:
            </span>
            {(
              [
                { value: "manual_upi", label: "UPI" },
                { value: "cash", label: "Cash" },
              ] as const
            ).map((m) => {
              const active = draft.payment_method === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => patch({ payment_method: m.value })}
                  className={`h-8 border-2 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] ${
                    active ? "border-ink bg-ink text-bone" : "border-ink/40 hover:border-ink"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
            {paymentMode === "offline" && draft.payment_method === "manual_upi" && (
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
                event is offline · prefer Cash
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Total (₹)" w="w-28">
              <input
                inputMode="numeric"
                value={draft.total_fee_inr}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
                  patch({
                    total_fee_inr: digits,
                    total_touched: true,
                  });
                }}
                title={`Suggested ${entryCount || 1} × ₹${perHandFee} = ₹${suggestedTotal}`}
                className={`${inputCls} text-right font-mono tabular-nums ${
                  waivedFee > 0 ? "border-gold" : ""
                }`}
              />
            </Field>
            <Field label="Paid (₹)" w="w-28">
              <input
                inputMode="numeric"
                value={draft.paid_amount_inr}
                onChange={(e) => {
                  // Digits only, cap at total fee (no overpayment).
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
                  const n = digits === "" ? 0 : Math.min(Number(digits), totalFee);
                  patch({
                    paid_amount_inr: digits === "" ? "" : String(n),
                    paid_touched: true,
                  });
                }}
                className={`${inputCls} text-right font-mono tabular-nums ${
                  paidNum === 0
                    ? ""
                    : paidNum >= totalFee
                    ? "border-moss"
                    : "border-rust"
                }`}
              />
            </Field>
            <Field label="Pending (₹)" w="w-28">
              <div
                className={`${inputCls} flex items-center justify-end font-mono tabular-nums ${
                  pendingFee > 0 ? "text-rust" : "text-moss"
                }`}
              >
                {pendingFee}
              </div>
            </Field>
            {waivedFee > 0 && (
              <span
                className="border-2 border-gold bg-gold/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink"
                title={`Suggested ₹${suggestedTotal} − Total ₹${totalFee}`}
              >
                Waived ₹{waivedFee}
              </span>
            )}
            {draft.payment_method === "manual_upi" && SHOW_UPI_PROOF_UI && (
              <Field label="UTR (opt)" w="w-44">
                <input
                  value={draft.payment_utr}
                  onChange={(e) =>
                    patch({
                      // UPI refs are uppercase alphanumeric, typically 12 chars
                      // but reservation IDs run up to 22. Strip everything else.
                      payment_utr: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "")
                        .slice(0, 22),
                    })
                  }
                  placeholder="UPI reference"
                  className={`${inputCls} font-mono`}
                />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              Quick:
            </span>
            {(
              [
                { label: "Full", value: totalFee },
                { label: "₹0", value: 0 },
              ] as const
            ).map((q) => {
              const active = paidNum === q.value;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() =>
                    patch({ paid_amount_inr: String(q.value), paid_touched: true })
                  }
                  className={`h-7 border-2 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-50 ${
                    active
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/40 hover:border-ink"
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              {entryCount || 1} {entryCount === 1 ? "entry" : "entries"} × ₹{defaultFee} = ₹{suggestedTotal}
              {waivedFee > 0 && <span className="ml-2 text-gold">· waived ₹{waivedFee}</span>}
            </span>
          </div>
          {SHOW_UPI_PROOF_UI && (draft.payment_method === "manual_upi" ? (
          <div className="flex items-center gap-3">
            {draft.proof_preview ? (
              <img
                src={draft.proof_preview}
                alt="proof"
                className="h-20 w-28 border-2 border-ink object-cover"
              />
            ) : (
              <div className="flex h-20 w-28 items-center justify-center border-2 border-dashed border-ink/40 font-mono text-[10px] uppercase text-ink/40">
                no proof
              </div>
            )}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setCam("proof")}
                className="border-2 border-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/30"
              >
                📷 capture proof
              </button>
              <FileFallback
                onPick={(b) => upload("proof", b)}
                label="📁 file (img/pdf)"
                accept="image/*,application/pdf"
              />
              {draft.proof_uploading && (
                <Spinner variant="inline" label="Uploading" />
              )}
              {draft.proof_key && !draft.proof_uploading && (
                <span className="font-mono text-[10px] uppercase text-moss">✓ ready</span>
              )}
            </div>
          </div>
          ) : (
            <p className="border-2 border-dashed border-ink/30 bg-kraft/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
              Cash collected at counter — no UTR/proof needed.
            </p>
          ))}
        </fieldset>

        {error && (
          <div className="border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className={`border-2 px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.25em] text-bone ${
              editingClientId
                ? "border-rust bg-rust hover:bg-rust/80"
                : "border-ink bg-ink hover:bg-rust hover:border-rust"
            }`}
          >
            {editingClientId ? "Update ↥" : "Save & next ↥"}
          </button>
          <button
            type="button"
            onClick={editingClientId ? cancelEdit : () => setDraft(emptyDraft(effectiveOfflineFee, defaultMethod, "offline"))}
            className="border-2 border-ink/40 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-ink/60 hover:border-ink hover:text-ink"
          >
            {editingClientId ? "Cancel edit" : "Clear form"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
            Ctrl+Enter
          </span>
        </div>
      </form>

      {/* ── RIGHT: registrations list + search ────────────────────── */}
      <aside className="border-2 border-ink bg-bone">
        {/* Sticky search header so it's always reachable while scrolling. */}
        <div className="sticky top-0 z-10 space-y-2 border-b-2 border-ink bg-bone p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-ink/60">
              Registrations
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 tabular-nums">
              {(() => {
                const sessionCount = saved.filter(
                  (r) => (r.saved_at ?? 0) > 0
                ).length;
                const serverCount = saved.length - sessionCount;
                if (query || payFilter || checkinFilter) {
                  const total = eventTotal ?? saved.length;
                  return `${serverCount} match${
                    serverCount === 1 ? "" : "es"
                  } of ${total}`;
                }
                return eventTotal !== null
                  ? `${saved.length} shown of ${eventTotal}`
                  : `${saved.length} shown`;
              })()}
            </p>
          </div>
          {/* Bulk error recovery. Only renders when at least one row is
              stuck in "error" — otherwise the header stays clean. */}
          {(() => {
            const errCount = saved.filter((r) => r.status === "error").length;
            if (errCount === 0) return null;
            return (
              <div className="flex items-center gap-2 border-2 border-rust bg-rust/5 px-2 py-1">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rust">
                  {errCount} failed
                </span>
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    onClick={retryAllErrors}
                    className="border-2 border-rust px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white"
                  >
                    Retry all
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        await confirm({
                          message: `Discard ${errCount} failed row${
                            errCount === 1 ? "" : "s"
                          }? They will be removed from the queue and from local storage.`,
                          confirmLabel: "Discard",
                          tone: "danger",
                        })
                      ) {
                        clearFailedRows();
                      }
                    }}
                    className="border-2 border-ink/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/70 hover:border-ink hover:text-ink"
                  >
                    Clear
                  </button>
                </div>
              </div>
            );
          })()}
          <div className="relative">
            <span
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-ink/40"
              aria-hidden
            >
              ⌕
            </span>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (query) setQuery("");
                  else (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search Name, Chest, Mobile, District…"
              className={`${inputCls} pl-7 pr-16`}
              type="search"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 hidden font-mono text-[10px] uppercase tracking-[0.15em] text-ink/30 sm:block">
              {searching ? "⟳" : "/"}
            </span>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                title="Clear (Esc)"
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 font-mono text-xs text-ink/50 hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
          {/* Two-axis filter chips: payment and check-in are orthogonal. */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.25em] text-ink/40">
                Pay
              </span>
              {(
                [
                  ["", "All"],
                  ["paid", "Paid"],
                  ["non-paid", "Non-paid"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value || "all-pay"}
                  type="button"
                  onClick={() => setPayFilter(value)}
                  className={`border-2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${
                    payFilter === value
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/30 text-ink/60 hover:border-ink hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.25em] text-ink/40">
                Check-in
              </span>
              {(
                [
                  ["", "All"],
                  ["weighed-in", "Checked-in"],
                  ["not-weighed-in", "Not checked-in"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value || "all-checkin"}
                  type="button"
                  onClick={() => setCheckinFilter(value)}
                  className={`border-2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${
                    checkinFilter === value
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/30 text-ink/60 hover:border-ink hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Result list. Sticky header + tall scroll area for ergonomics. */}
        <div className="p-4 pt-3">
          {saved.length === 0 ? (
            <div className="border-2 border-dashed border-ink/30 p-6 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
                {query || payFilter || checkinFilter
                  ? "No matches."
                  : "No registrations yet for this event."}
              </p>
              {(query || payFilter || checkinFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPayFilter("");
                    setCheckinFilter("");
                  }}
                  className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="max-h-[72vh] space-y-2 overflow-y-auto pr-1">
              {(() => {
                const sessionRows = saved.filter(
                  (r) => (r.saved_at ?? 0) > 0
                );
                const serverRows = saved.filter(
                  (r) => (r.saved_at ?? 0) === 0
                );
                const renderGroupHeader = (label: string, n: number) => (
                  <li
                    key={`hdr-${label}`}
                    className="sticky top-0 bg-bone pb-1 pt-2 font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-ink/40"
                  >
                    {label} · {n}
                  </li>
                );
                const renderRow = (r: SavedRow) => {
                  const status = r.status ?? "saved";
                  const isEditing = editingClientId === r.client_id;
                  const borderTone = isEditing
                    ? "border-rust"
                    : status === "error"
                    ? "border-rust"
                    : status === "syncing"
                    ? "border-ink/50"
                    : "border-ink/30";
                  const canClickToEdit =
                    !isEditing && status === "saved" && !!r.client_id;
                  return (
                    <li
                      key={r.client_id ?? r.id}
                      className={`group flex items-start justify-between gap-2 border ${borderTone} bg-bone p-2 transition-colors ${
                        isEditing
                          ? "bg-rust/5"
                          : canClickToEdit
                          ? "cursor-pointer hover:border-ink hover:bg-ink/[0.03]"
                          : ""
                      }`}
                      onClick={
                        canClickToEdit
                          ? () => void loadRow(r.client_id!)
                          : undefined
                      }
                      role={canClickToEdit ? "button" : undefined}
                      tabIndex={canClickToEdit ? 0 : undefined}
                      onKeyDown={
                        canClickToEdit
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                void loadRow(r.client_id!);
                              }
                            }
                          : undefined
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-black tracking-tight">
                          {r.chest_no ? (
                            <span className="tabular-nums text-ink/50">{r.chest_no} </span>
                          ) : null}
                          {r.initial ? `${r.initial}. ` : ""}
                          <Highlight text={r.full_name ?? ""} q={query} />
                          {r.lifecycle === "disqualified" ? (
                            <span className="ml-1.5 align-middle">
                              <Pill tone="bad" label="DQ" />
                            </span>
                          ) : r.lifecycle === "withdrawn" ? (
                            <span className="ml-1.5 align-middle">
                              <Pill tone="muted" label="withdrawn" />
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate font-mono text-[10px] uppercase tracking-[0.15em] text-ink/60">
                          <Highlight
                            text={r.district ?? r.team ?? "—"}
                            q={query}
                          />
                          {r.declared_weight_kg
                            ? ` · ${r.declared_weight_kg}kg`
                            : ""}
                          {r.weight_class_code
                            ? ` · ${r.weight_class_code}`
                            : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <PaymentRailPill row={r} />
                          <CheckinRailPill row={r} />
                        </div>
                        {status === "error" && r.error && (
                          <p className="mt-1 font-mono text-[10px] text-rust">
                            {r.error}
                          </p>
                        )}
                      </div>
                      <div
                        className="flex shrink-0 flex-col items-end gap-1"
                        // Buttons must not bubble click → row → loadRow.
                        onClick={(e) => e.stopPropagation()}
                      >
                        {status === "syncing" && (
                          <span
                            title="Uploading to cloud…"
                            className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50"
                          >
                            ⟳ sync
                          </span>
                        )}
                        {status === "saved" && !isEditing && (
                          <span
                            title="Saved to cloud"
                            className="font-mono text-[10px] uppercase tracking-[0.2em] text-moss"
                          >
                            ✓
                          </span>
                        )}
                        {isEditing && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
                            editing
                          </span>
                        )}
                        {status === "error" && r.client_id && (
                          <button
                            type="button"
                            onClick={() => retryRow(r.client_id!)}
                            className="border-2 border-rust px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white"
                          >
                            retry
                          </button>
                        )}
                        {!isEditing && r.client_id && (
                          <div className="flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              title="Edit this row"
                              onClick={() => void loadRow(r.client_id!)}
                              className="border-2 border-ink/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-ink/70 hover:border-ink hover:text-ink"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              title="Delete this row"
                              onClick={async () => {
                                if (
                                  await confirm({
                                    message: `Delete ${r.full_name ?? "this row"}?`,
                                    confirmLabel: "Delete",
                                    tone: "danger",
                                  })
                                ) {
                                  void deleteRow(r.client_id!);
                                }
                              }}
                              className="border-2 border-ink/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-ink/70 hover:border-rust hover:text-rust"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                };
                const out: React.ReactNode[] = [];
                if (sessionRows.length > 0) {
                  out.push(
                    renderGroupHeader("Just added", sessionRows.length)
                  );
                  for (const r of sessionRows) out.push(renderRow(r));
                }
                if (serverRows.length > 0) {
                  out.push(
                    renderGroupHeader(
                      query || payFilter || checkinFilter ? "Matches" : "Recent",
                      serverRows.length
                    )
                  );
                  for (const r of serverRows) out.push(renderRow(r));
                }
                return out;
              })()}
            </ul>
          )}
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-ink/40">
            <kbd className="border border-ink/30 px-1">/</kbd> focus search ·{" "}
            <kbd className="border border-ink/30 px-1">Esc</kbd> clear · click
            a row to load it
          </p>
        </div>
      </aside>

      <CameraCapture
        open={cam !== null}
        title={cam === "photo" ? "Capture athlete photo" : "Capture payment proof"}
        facing={cam === "photo" ? "user" : "environment"}
        onCancel={() => setCam(null)}
        onCapture={(blob) => {
          const which = cam;
          setCam(null);
          if (which) upload(which, blob);
        }}
      />
    </div>
  );
}

// ── Small UI helpers ────────────────────────────────────────────────────
const inputCls =
  "h-9 w-full border-2 border-ink/40 bg-bone px-2 text-sm focus:border-ink focus:outline-none";

// Highlight every case-insensitive occurrence of `q` inside `text`.
// Returns a fragment so it composes with surrounding text in the row.
// Numeric queries don't tend to appear inside names/districts, but we
// still highlight them when they do (e.g. "12th Street" ↔ "12").
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle || !text) return <>{text}</>;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const splitter = new RegExp(`(${escaped})`, "ig");
  const lower = needle.toLowerCase();
  const parts = text.split(splitter);
  return (
    <>
      {parts.map((p, i) =>
        p && p.toLowerCase() === lower ? (
          <mark key={i} className="bg-volt/40 px-0.5 text-ink">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Field({
  label,
  children,
  w,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  w?: string;
  grow?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${grow ? "flex-1" : ""} ${w ?? ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
        {label}
      </span>
      {children}
    </label>
  );
}

function HandPicker({
  value,
  onChange,
}: {
  value: "" | Hand;
  onChange: (h: Hand) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["R", "L", "B"] as const).map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onChange(h)}
          className={`h-9 flex-1 border-2 font-mono text-xs font-bold ${
            value === h ? "border-ink bg-ink text-bone" : "border-ink/40 hover:border-ink"
          }`}
        >
          {h}
        </button>
      ))}
    </div>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: "green" | "neutral" | "warn" | "bad" | "muted";
  label: string;
}) {
  const cls =
    tone === "green"
      ? "border-moss bg-moss text-white"
      : tone === "bad"
      ? "border-rust bg-rust text-white"
      : tone === "warn"
      ? "border-rust text-rust"
      : tone === "muted"
      ? "border-ink/20 text-ink/40"
      : "border-ink/40 text-ink/70";
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] ${cls}`}
    >
      {label}
    </span>
  );
}

function PaymentRailPill({ row }: { row: SavedRow }) {
  const total = row.total_fee_inr ?? null;
  const collected = row.collected_inr ?? row.paid_amount_inr ?? 0;
  const remaining =
    row.remaining_inr ?? (total != null ? Math.max(0, total - collected) : null);
  if (row.payment_status === "verified" || (total != null && remaining === 0 && collected > 0)) {
    return <Pill tone="green" label={`paid ₹${collected.toLocaleString("en-IN")}`} />;
  }
  if (row.payment_status === "rejected") {
    return <Pill tone="bad" label="rejected" />;
  }
  if (collected > 0 && total != null && remaining != null && remaining > 0) {
    return (
      <Pill
        tone="warn"
        label={`₹${collected.toLocaleString("en-IN")} / ₹${total.toLocaleString("en-IN")}`}
      />
    );
  }
  return <Pill tone="neutral" label="due" />;
}

function CheckinRailPill({ row }: { row: SavedRow }) {
  const s = row.checkin_status ?? (row.approved ? "weighed_in" : "not_arrived");
  if (s === "weighed_in") return <Pill tone="green" label="weighed-in" />;
  if (s === "no_show") return <Pill tone="bad" label="no-show" />;
  return null; // not_arrived: keep row quiet
}

function FileFallback({
  onPick,
  label,
  accept,
}: {
  onPick: (b: Blob) => void;
  label: string;
  accept: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="border-2 border-ink/40 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:border-ink"
      >
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

// ── Smart DOB input ─────────────────────────────────────────────────────
// Three boxes that feel like one field. Operators can type either way:
//   • "15" → "3" → "2010"           (auto-tabs across boxes)
//   • "1" → "5"  in DD then a digit > 1 in MM auto-tabs to YYYY
//   • paste "15/03/2010", "15-3-2010", "15.3.2010", "15032010", "2010-03-15"
//     anywhere → fields get split correctly
//   • Backspace at the start of MM/YYYY jumps to the previous box
//   • Day clamped 1–31, month 1–12, year 1900–2030
function clampInt(s: string, min: number, max: number): string {
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  if (n < min) return String(min);
  if (n > max) return String(max);
  return s;
}

function parsePastedDate(raw: string): { d: string; m: string; y: string } | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) {
    // Could be DDMMYYYY or YYYYMMDD. Disambiguate by leading 19/20.
    if (/^(19|20)/.test(digits)) {
      const y = digits.slice(0, 4);
      const m = digits.slice(4, 6);
      const d = digits.slice(6, 8);
      return { d, m, y };
    }
    return { d: digits.slice(0, 2), m: digits.slice(2, 4), y: digits.slice(4, 8) };
  }
  // Tokenised "DD?MM?YYYY" or "YYYY?MM?DD".
  const parts = raw.split(/[^\d]+/).filter(Boolean);
  if (parts.length === 3) {
    if (parts[0].length === 4) return { d: parts[2], m: parts[1], y: parts[0] };
    return { d: parts[0], m: parts[1], y: parts[2] };
  }
  return null;
}

function isRealDate(d: number, m: number, y: number): boolean {
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function DobInput({
  day,
  month,
  year,
  eventStartsAt,
  onChange,
  inputCls,
}: {
  day: string;
  month: string;
  year: string;
  eventStartsAt: string;
  onChange: (d: string, m: string, y: string) => void;
  inputCls: string;
}) {
  const dayRef = useRef<HTMLInputElement>(null);
  const monRef = useRef<HTMLInputElement>(null);
  const yrRef = useRef<HTMLInputElement>(null);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/\D/.test(text) && text.length < 5) return; // looks like just digits — let normal flow handle
    const parsed = parsePastedDate(text);
    if (!parsed) return;
    e.preventDefault();
    onChange(
      clampInt(parsed.d.slice(0, 2), 1, 31),
      clampInt(parsed.m.slice(0, 2), 1, 12),
      clampInt(parsed.y.slice(0, 4), 1900, 2030)
    );
    yrRef.current?.focus();
  };

  const onDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // If the user types a separator after a single digit, treat as auto-tab.
    const raw = e.target.value;
    if (/[^\d]/.test(raw) && day.length === 1) {
      monRef.current?.focus();
      return;
    }
    const v = raw.replace(/\D/g, "").slice(0, 2);
    onChange(v, month, year);
    // Auto-advance: when full (2 digits) OR when first digit unambiguously
    // can't be the start of a 2-digit day (4-9 → days 4-9).
    if (v.length === 2 || (v.length === 1 && Number(v) >= 4)) {
      monRef.current?.focus();
      monRef.current?.select();
    }
  };

  const onMonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (/[^\d]/.test(raw) && month.length === 1) {
      yrRef.current?.focus();
      return;
    }
    const v = raw.replace(/\D/g, "").slice(0, 2);
    onChange(day, v, year);
    if (v.length === 2 || (v.length === 1 && Number(v) >= 2)) {
      yrRef.current?.focus();
      yrRef.current?.select();
    }
  };

  const onYrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
    onChange(day, month, v);
  };

  // Backspace at empty field → jump to previous and remove last digit there.
  const onMonKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && month === "") {
      e.preventDefault();
      onChange(day.slice(0, -1), month, year);
      dayRef.current?.focus();
    }
  };
  const onYrKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && year === "") {
      e.preventDefault();
      onChange(day, month.slice(0, -1), year);
      monRef.current?.focus();
    }
  };

  // Clamp + auto-expand on blur. 2-digit years pivot at 25 — "99" → 1999,
  // "08" → 2008 — a reasonable cutoff for adult athletes in 2026.
  const blurClamp = () => {
    const d = clampInt(day, 1, 31);
    const m = clampInt(month, 1, 12);
    let y = year;
    if (year.length === 2) {
      const n = Number(year);
      y = String(n > 25 ? 1900 + n : 2000 + n);
    }
    if (y.length === 4) y = clampInt(y, 1900, 2030);
    if (d !== day || m !== month || y !== year) onChange(d, m, y);
  };

  // ── Live validation ──────────────────────────────────────────────
  const allFilled = day !== "" && month !== "" && year.length === 4;
  let problem: string | null = null;
  let age: number | null = null;
  if (allFilled) {
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    if (!isRealDate(d, m, y)) {
      problem = "not a real date";
    } else {
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      age = ageOnMatchDay(iso, eventStartsAt);
      if (age < 5) problem = `too young (age ${age})`;
      else if (age > 80) problem = `too old (age ${age})`;
    }
  } else if (year !== "" && year.length < 4) {
    problem = "year must be 4 digits";
  }
  const invalid = problem !== null;
  const fieldCls = `${inputCls} text-center font-mono tabular-nums ${
    invalid ? "border-rust" : age !== null ? "border-moss" : ""
  }`;

  return (
    <div onPaste={handlePaste}>
      <div className="flex gap-1">
        <input
          ref={dayRef}
          inputMode="numeric"
          value={day}
          onChange={onDayChange}
          onBlur={blurClamp}
          placeholder="DD"
          className={`${fieldCls} w-12`}
          maxLength={2}
          aria-label="Day"
          aria-invalid={invalid}
        />
        <input
          ref={monRef}
          inputMode="numeric"
          value={month}
          onChange={onMonChange}
          onKeyDown={onMonKey}
          onBlur={blurClamp}
          placeholder="MM"
          className={`${fieldCls} w-12`}
          maxLength={2}
          aria-label="Month"
          aria-invalid={invalid}
        />
        <input
          ref={yrRef}
          inputMode="numeric"
          value={year}
          onChange={onYrChange}
          onKeyDown={onYrKey}
          onBlur={blurClamp}
          placeholder="YYYY"
          className={`${fieldCls} w-20`}
          maxLength={4}
          aria-label="Year"
          aria-invalid={invalid}
        />
      </div>
      {problem && (
        <p
          className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-rust"
          role="alert"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

// ── District combobox: instant filter, no UI library ────────────────────
function DistrictCombo({
  value,
  onChange,
  districts,
}: {
  value: string;
  onChange: (v: string) => void;
  districts: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) => d.toLowerCase().includes(q));
  }, [value, districts]);

  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onFocus={() => {
          setOpen(true);
          setHover(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHover(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHover((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHover((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && matches[hover]) {
            e.preventDefault();
            pick(matches[hover]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Type a TN district…"
        className={inputCls}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 max-h-64 overflow-y-auto border-2 border-ink bg-bone shadow-md">
          {matches.map((d, i) => (
            <li
              key={d}
              onMouseEnter={() => setHover(i)}
              onMouseDown={(e) => {
                // mousedown so it fires before input blur
                e.preventDefault();
                pick(d);
              }}
              className={`cursor-pointer px-3 py-1.5 font-mono text-xs ${
                i === hover ? "bg-ink text-bone" : "hover:bg-kraft/30"
              }`}
            >
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
