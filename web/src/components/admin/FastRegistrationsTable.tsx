"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import PendingLink from "@/components/PendingLink";
import Spinner from "@/components/Spinner";
import ProofReviewModal from "./ProofReviewModal";
import { useConfirm } from "@/components/ConfirmDialog";
import { groupRowsByDistrict } from "@/lib/registrations/group-by-district";

type PaymentCollection = {
  id: string;
  amount_inr: number;
  method: string;
  reversed_at: string | null;
  payer_label?: string | null;
};

type Payment = {
  id: string;
  amount_inr: number | null;
  status: string;
  method: string | null;
  utr: string | null;
  proof_url: string | null;
  verified_at: string | null;
  payment_collections?: PaymentCollection[] | null;
};

/** Sum of active (non-reversed) collections. */
function collectedInr(p: Payment | null): number {
  if (!p?.payment_collections) return 0;
  return p.payment_collections.reduce(
    (s, c) => (c.reversed_at ? s : s + (c.amount_inr ?? 0)),
    0
  );
}

/** Total fee minus collected; never negative. */
function remainingInr(p: Payment | null): number {
  if (!p) return 0;
  return Math.max(0, (p.amount_inr ?? 0) - collectedInr(p));
}

type Row = {
  id: string;
  event_id: string;
  chest_no: number | null;
  full_name: string | null;
  initial: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  weight_class_code: string | null;
  status: string | null;
  checkin_status: "not_arrived" | "weighed_in" | "no_show" | null;
  gender: string | null;
  nonpara_classes: string[] | null;
  nonpara_hands: string[] | null;
  nonpara_hand: string | null;
  para_codes: string[] | null;
  para_hand: string | null;
  payments: Payment[] | Payment | null;
};

interface Filters {
  q: string;
  division: string;
  /** Lifecycle: '' | 'active' | 'withdrawn' | 'disqualified'. */
  entry: string;
  /** Check-in: '' | 'weighed_in' | 'no_show' | 'not_arrived'. */
  checkin: string;
  payment: string;
}

interface Scope {
  eventId: string | null;
  eventName?: string;
  eventSlug?: string;
}

interface Props {
  scope: Scope;
  /** Pre-fill the q (search) field when arriving from a dashboard link. */
  initialQuery?: string;
  /** Pre-select a district. The free-text search field is reused so the
   * filter chip remains discoverable and removable by the operator. */
  initialDistrict?: string;
  /** Open in district-grouped view ("By district" lens). */
  initialGroup?: "district" | "none";
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500] as const;
const DEFAULT_PAGE_SIZE = 100;
const DISTRICT_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
const DEFAULT_DISTRICT_PAGE_SIZE = 10;
const ROWS_PER_DISTRICT_OPTIONS = [10, 25, 50, 100, 0] as const; // 0 = "All"
const DEFAULT_ROWS_PER_DISTRICT = 25;
// In "By district" view we paginate districts client-side, so we need
// every matching row in one shot. The server caps response size; this
// stays well under that cap while covering realistic event sizes.
const DISTRICT_FETCH_SIZE = 5000;

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All payment" },
  { value: "verified", label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "unpaid", label: "Unpaid (no proof)" },
  { value: "review", label: "Awaiting review" },
  { value: "collected", label: "Cash / offline" },
  { value: "rejected", label: "Rejected" },
];

function getPayment(r: Row): Payment | null {
  if (!r.payments) return null;
  return Array.isArray(r.payments) ? r.payments[0] ?? null : r.payments;
}

type State = {
  rows: Row[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  selected: Set<string>;
  lastClicked: string | null;
  cursor: number; // keyboard row cursor
  flash: string | null;
};

type Action =
  | { type: "load.start" }
  | { type: "load.done"; rows: Row[]; total: number; page: number }
  | { type: "load.fail"; error: string }
  | { type: "page"; page: number }
  | { type: "select.toggle"; id: string; range?: boolean; allIds: string[] }
  | { type: "select.set"; ids: string[] }
  | { type: "select.clear" }
  | { type: "patch"; ids: string[]; patch: Partial<Row> }
  | { type: "patchPayment"; ids: string[]; patch: Partial<Payment> }
  | { type: "remove"; ids: string[] }
  | { type: "cursor"; cursor: number }
  | { type: "flash"; msg: string | null };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "load.start":
      return { ...s, loading: true, error: null };
    case "load.done":
      return {
        ...s,
        loading: false,
        rows: a.rows,
        total: a.total,
        page: a.page,
        cursor: Math.min(s.cursor, Math.max(0, a.rows.length - 1)),
      };
    case "load.fail":
      return { ...s, loading: false, error: a.error };
    case "page":
      return { ...s, page: a.page };
    case "select.toggle": {
      const next = new Set(s.selected);
      if (a.range && s.lastClicked) {
        const i = a.allIds.indexOf(s.lastClicked);
        const j = a.allIds.indexOf(a.id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          for (let k = lo; k <= hi; k++) next.add(a.allIds[k]);
        }
      } else if (next.has(a.id)) {
        next.delete(a.id);
      } else {
        next.add(a.id);
      }
      return { ...s, selected: next, lastClicked: a.id };
    }
    case "select.set":
      return { ...s, selected: new Set(a.ids) };
    case "select.clear":
      return { ...s, selected: new Set(), lastClicked: null };
    case "patch": {
      const ids = new Set(a.ids);
      return {
        ...s,
        rows: s.rows.map((r) => (ids.has(r.id) ? { ...r, ...a.patch } : r)),
      };
    }
    case "patchPayment": {
      const ids = new Set(a.ids);
      return {
        ...s,
        rows: s.rows.map((r) => {
          const p = getPayment(r);
          if (!p || !ids.has(p.id)) return r;
          return { ...r, payments: [{ ...p, ...a.patch }] };
        }),
      };
    }
    case "remove": {
      const ids = new Set(a.ids);
      const rows = s.rows.filter((r) => !ids.has(r.id));
      const sel = new Set(s.selected);
      ids.forEach((id) => sel.delete(id));
      return {
        ...s,
        rows,
        selected: sel,
        total: Math.max(0, s.total - ids.size),
      };
    }
    case "cursor":
      return { ...s, cursor: a.cursor };
    case "flash":
      return { ...s, flash: a.msg };
  }
}

const initial: State = {
  rows: [],
  total: 0,
  loading: true,
  error: null,
  page: 1,
  selected: new Set(),
  lastClicked: null,
  cursor: -1,
  flash: null,
};

export default function FastRegistrationsTable({
  scope,
  initialQuery,
  initialDistrict,
  initialGroup,
}: Props) {
  const confirmDialog = useConfirm();
  const [filters, setFilters] = useState<Filters>({
    q: initialQuery ?? initialDistrict ?? "",
    division: "",
    entry: "",
    checkin: "",
    payment: "",
  });
  const [groupBy, setGroupBy] = useState<"none" | "district">(
    initialGroup ?? (initialDistrict ? "district" : "none")
  );
  // Page size for the registrations table (rows per server fetch). Persisted
  // per-browser so operators don't have to re-pick "500" every reload.
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_PAGE_SIZE;
    const raw = window.localStorage.getItem("regs.pageSize");
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PAGE_SIZE;
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("regs.pageSize", String(pageSize)); } catch {}
  }, [pageSize]);
  // Separate pagination for the "By district" lens. Slices the computed
  // `groups` client-side so the operator can flip through districts without
  // refetching, while the row pager (bottom) still controls how many
  // registrations are loaded from the server.
  const [districtPage, setDistrictPage] = useState(1);
  const [districtsPerPage, setDistrictsPerPage] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_DISTRICT_PAGE_SIZE;
    const raw = window.localStorage.getItem("regs.districtsPerPage");
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_DISTRICT_PAGE_SIZE;
    return (DISTRICT_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
      ? n
      : DEFAULT_DISTRICT_PAGE_SIZE;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("regs.districtsPerPage", String(districtsPerPage)); } catch {}
  }, [districtsPerPage]);
  // How many rows to show inside each district card before its own row
  // pager kicks in. 0 = "All". Persisted alongside the other pager prefs.
  const [rowsPerDistrict, setRowsPerDistrict] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_ROWS_PER_DISTRICT;
    const raw = window.localStorage.getItem("regs.rowsPerDistrict");
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_ROWS_PER_DISTRICT;
    return (ROWS_PER_DISTRICT_OPTIONS as readonly number[]).includes(n)
      ? n
      : DEFAULT_ROWS_PER_DISTRICT;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("regs.rowsPerDistrict", String(rowsPerDistrict)); } catch {}
  }, [rowsPerDistrict]);
  // Per-district current page (rows pager inside each district card).
  // Keyed by group key. Reset whenever the row data refreshes so we
  // don't leave a district stuck on a page that no longer exists.
  const [districtRowPages, setDistrictRowPages] = useState<Record<string, number>>({});
  const setDistrictRowPage = useCallback((key: string, p: number) => {
    setDistrictRowPages((prev) => ({ ...prev, [key]: p }));
  }, []);
  // Collapsed group keys for the "By district" view. Per the operator UX
  // requirement, every district starts collapsed on initial page load —
  // we don't restore from localStorage. Toggling expand persists only for
  // the current session.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const collapseSeededRef = useRef(false);
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 200);
    return () => clearTimeout(t);
  }, [filters.q]);

  const [state, dispatch] = useReducer(reducer, initial);
  const tableRef = useRef<HTMLTableElement>(null);
  const [proofModal, setProofModal] = useState<{ paymentId: string } | null>(null);
  // "Collect ₹X" popover. Either a single payment id OR a list (bulk / district).
  const [collectTarget, setCollectTarget] = useState<
    | null
    | { kind: "single"; paymentId: string; amount: number; label: string }
    | {
        kind: "bulk";
        paymentIds: string[];
        total: number;
        label: string;
        /** Pre-fills the "Paid by" field (district / team name). */
        defaultPayer: string | null;
      }
  >(null);
  // Adjust-total + Reverse modals (live next to the row's Collect button).
  const [adjustTarget, setAdjustTarget] = useState<
    | null
    | {
        paymentId: string;
        currentTotal: number;
        collected: number;
        label: string;
      }
  >(null);
  const [undoTarget, setUndoTarget] = useState<
    | null
    | {
        paymentId: string;
        collected: number;
        label: string;
      }
  >(null);

  const openAdjust = useCallback((p: Payment) => {
    setAdjustTarget({
      paymentId: p.id,
      currentTotal: p.amount_inr ?? 0,
      collected: collectedInr(p),
      label: `Adjust total fee · ₹${(p.amount_inr ?? 0).toLocaleString("en-IN")} now`,
    });
  }, []);
  const openUndo = useCallback((p: Payment) => {
    setUndoTarget({
      paymentId: p.id,
      collected: collectedInr(p),
      label: `₹${collectedInr(p).toLocaleString("en-IN")} collected over ${
        p.payment_collections?.filter((c) => !c.reversed_at).length ?? 0
      } collection(s)`,
    });
  }, []);

  const reqIdRef = useRef(0);
  const fetchList = useCallback(
    async (page: number) => {
      const id = ++reqIdRef.current;
      dispatch({ type: "load.start" });
      const sp = new URLSearchParams();
      if (scope.eventId) sp.set("event_id", scope.eventId);
      if (debouncedQ) sp.set("q", debouncedQ);
      if (filters.division) sp.set("division", filters.division);
      if (filters.entry) sp.set("entry", filters.entry);
      if (filters.checkin) sp.set("checkin", filters.checkin);
      if (filters.payment) sp.set("payment", filters.payment);
      sp.set("page", String(page));
      sp.set("pageSize", String(groupBy === "district" ? DISTRICT_FETCH_SIZE : pageSize));
      try {
        const res = await fetch(`/api/admin/registrations?${sp.toString()}`, {
          cache: "no-store",
        });
        const j = await res.json();
        if (id !== reqIdRef.current) return; // stale
        if (!res.ok) {
          dispatch({ type: "load.fail", error: j.error ?? "load failed" });
          return;
        }
        dispatch({
          type: "load.done",
          rows: j.rows ?? [],
          total: j.total ?? 0,
          page: j.page ?? page,
        });
      } catch (e) {
        if (id !== reqIdRef.current) return;
        dispatch({ type: "load.fail", error: (e as Error).message });
      }
    },
    [scope.eventId, debouncedQ, filters.division, filters.entry, filters.checkin, filters.payment, pageSize, groupBy]
  );

  // Reset to page 1 when filters change.
  useEffect(() => {
    fetchList(1);
  }, [fetchList]);

  // Revalidate on focus + every 30s.
  useEffect(() => {
    const onFocus = () => fetchList(state.page);
    window.addEventListener("focus", onFocus);
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") fetchList(state.page);
    }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(iv);
    };
  }, [fetchList, state.page]);

  const allIds = useMemo(() => state.rows.map((r) => r.id), [state.rows]);
  const allSelectedOnPage = allIds.length > 0 && allIds.every((id) => state.selected.has(id));

  const selectedRows = useMemo(
    () => state.rows.filter((r) => state.selected.has(r.id)),
    [state.rows, state.selected]
  );
  const selectedPaymentIds = useMemo(
    () =>
      selectedRows
        .map((r) => getPayment(r))
        .filter((p): p is Payment => !!p && p.status === "pending" && !!p.utr)
        .map((p) => p.id),
    [selectedRows]
  );
  // Pending payments with NO proof — i.e. waiting on cash collection.
  // Used for the "Collect cash for selected" bulk action.
  const selectedCollectablePayments = useMemo(
    () =>
      selectedRows
        .map((r) => getPayment(r))
        .filter((p): p is Payment => !!p && p.status === "pending"),
    [selectedRows]
  );
  const selectedCollectTotal = useMemo(
    () =>
      selectedCollectablePayments.reduce(
        (s, p) => s + remainingInr(p),
        0
      ),
    [selectedCollectablePayments]
  );

  // ─── Group-by derivation ─────────────────────────────────────────
  // Groups rows by district (when enabled) and computes per-group ₹ totals
  // so the section header can show "Trichy · ₹3,500 paid · ₹6,500 pending"
  // and a one-click "Collect ₹6,500" button.
  type Group = {
    key: string;
    label: string;
    rows: Row[];
    collectedInr: number;
    pendingInr: number;
    collectablePayments: Payment[];
  };
  const groups = useMemo<Group[]>(() => {
    if (groupBy !== "district") return [];
    // Adapter: shape internal Row+payment into the pure helper's
    // GroupableRow shape so we can keep this file's types richer.
    const adapted = state.rows.map((r) => {
      const p = getPayment(r);
      const collected = collectedInr(p);
      const remaining = remainingInr(p);
      return {
        row: r,
        district: r.district,
        team: r.team,
        payment: p
          ? {
              id: p.id,
              status: p.status as "pending" | "verified" | "rejected",
              amount_inr: p.amount_inr,
              collected_inr: collected,
              remaining_inr: remaining,
            }
          : null,
      };
    });
    const pure = groupRowsByDistrict(
      adapted.map((a) => ({
        id: a.row.id,
        district: a.district,
        team: a.team,
        payment: a.payment,
      }))
    );
    // Re-attach full Row objects (and full Payment objects with proof_url
    // etc) to each group, since downstream UI needs them.
    const byId = new Map(adapted.map((a) => [a.row.id, a.row]));
    const fullPaymentById = new Map(
      adapted.flatMap((a) => (a.payment ? [[a.payment.id, getPayment(byId.get(a.row.id)!)!]] : []))
    );
    return pure.map((g) => ({
      key: g.key,
      label: g.label,
      rows: g.rows.map((gr) => byId.get(gr.id)!).filter(Boolean),
      collectedInr: g.collectedInr,
      pendingInr: g.pendingInr,
      collectablePayments: g.collectablePayments
        .map((cp) => fullPaymentById.get(cp.id))
        .filter((p): p is Payment => !!p),
    }));
  }, [groupBy, state.rows]);

  // Seed every district as collapsed the first time groups appear after
  // arriving in district view. Subsequent toggles persist for the session.
  useEffect(() => {
    if (groupBy !== "district") {
      collapseSeededRef.current = false;
      return;
    }
    if (collapseSeededRef.current) return;
    if (groups.length === 0) return;
    collapseSeededRef.current = true;
    setCollapsedKeys(new Set(groups.map((g) => g.key)));
  }, [groupBy, groups]);

  // Clamp / reset district pager when the underlying group list shrinks.
  const districtTotalPages = Math.max(
    1,
    Math.ceil(groups.length / districtsPerPage)
  );
  useEffect(() => {
    if (districtPage > districtTotalPages) setDistrictPage(districtTotalPages);
  }, [districtPage, districtTotalPages]);
  useEffect(() => {
    setDistrictPage(1);
  }, [groupBy, debouncedQ, filters.division, filters.entry, filters.checkin, filters.payment, districtsPerPage]);

  const visibleGroups = useMemo(() => {
    if (groupBy !== "district") return groups;
    const start = (districtPage - 1) * districtsPerPage;
    return groups.slice(start, start + districtsPerPage);
  }, [groupBy, groups, districtPage, districtsPerPage]);

  // Reset the per-district row pages whenever the underlying row set
  // changes or the per-district window size changes — leaves no stale
  // "page 4" hanging around when a district now has only 8 rows.
  useEffect(() => {
    setDistrictRowPages({});
  }, [state.rows, rowsPerDistrict]);

  // ─── Mutations ────────────────────────────────────────────────────
  const flash = useCallback((msg: string) => {
    dispatch({ type: "flash", msg });
    setTimeout(() => dispatch({ type: "flash", msg: null }), 2500);
  }, []);

  async function bulkPaymentAction(action: "verify" | "reject") {
    if (selectedPaymentIds.length === 0) {
      flash("no payments awaiting review in selection");
      return;
    }
    if (action === "reject" && !(await confirmDialog({ message: `Reject ${selectedPaymentIds.length} payment(s)?`, confirmLabel: "Reject", tone: "danger" }))) return;
    // Optimistic
    dispatch({
      type: "patchPayment",
      ids: selectedPaymentIds,
      patch: { status: action === "verify" ? "verified" : "rejected" },
    });
    if (action === "verify") {
      // Optimistically keep the legacy registrations.status mirror in sync
      // for any rows whose payment was previously not verified. The server
      // is the source of truth; this just avoids a flash of stale UI.
      const regIds = selectedRows
        .filter((r) => {
          const p = getPayment(r);
          return p && selectedPaymentIds.includes(p.id) && p.status !== "verified";
        })
        .map((r) => r.id);
      if (regIds.length > 0) dispatch({ type: "patch", ids: regIds, patch: { status: "paid" } });
    }
    const res = await fetch(`/api/admin/payments/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedPaymentIds, action }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(j.error ?? "bulk failed — refreshing");
      fetchList(state.page);
      return;
    }
    flash(
      `${action}: ${j.updated ?? 0} updated` +
        (j.alreadyResolved ? `, ${j.alreadyResolved} already resolved` : "")
    );
    // background revalidate so we pick up server-side derived state.
    fetchList(state.page);
  }

  /**
   * Marks one or many pending payments as collected (cash / counter-UPI /
   * waiver). The actual method + reference + amount come from the popover.
   * No optimistic state flip — partials must NOT show as verified, and
   * the server is the source of truth for whether a collection covered
   * the remaining balance. We refetch immediately on settle.
   */
  async function performCollect(opts: {
    paymentIds: string[];
    method: "cash" | "manual_upi" | "waiver";
    reference: string | null;
    amountOverride: number | null; // single only
    waiveRemainder: boolean;
    /** Bulk only. When set, server allocates oldest-first across the ids. */
    poolAmount: number | null;
    /** Bulk only. Stamped onto each created collection. */
    payerLabel: string | null;
  }) {
    if (opts.paymentIds.length === 0) {
      flash("nothing to collect");
      return;
    }

    // Single-id with optional amount override → /collect; many ids → /bulk.
    if (opts.paymentIds.length === 1) {
      const res = await fetch(
        `/api/admin/payments/${opts.paymentIds[0]}/collect`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: opts.method,
            amount_inr: opts.amountOverride,
            waive_remainder: opts.waiveRemainder,
            reference: opts.reference,
          }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(j.error ?? "collect failed");
      } else if (j.alreadyResolved) {
        flash("already resolved by another desk");
      } else if (j.now_verified) {
        flash(`paid in full · ₹${(j.collected_inr ?? 0).toLocaleString("en-IN")} collected`);
      } else {
        flash(
          `partial · ₹${(j.collected_inr ?? 0).toLocaleString("en-IN")} so far, ₹${(j.remaining_inr ?? 0).toLocaleString("en-IN")} owed`
        );
      }
    } else {
      const res = await fetch(`/api/admin/payments/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: opts.paymentIds,
          action: "collect",
          method: opts.method,
          waive_remainder: opts.waiveRemainder,
          reference: opts.reference,
          ...(opts.poolAmount !== null
            ? { pool_amount_inr: opts.poolAmount }
            : {}),
          ...(opts.payerLabel ? { payer_label: opts.payerLabel } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(j.error ?? "bulk collect failed");
      } else if (j.pool) {
        flash(
          `pool · ${j.pool.fully} fully, ${j.pool.partial} partial, ${j.pool.untouched} untouched` +
            (j.pool.leftover_inr > 0
              ? ` · ₹${j.pool.leftover_inr.toLocaleString("en-IN")} leftover`
              : "")
        );
      } else {
        flash(
          `collected ${j.updated ?? 0}` +
            (j.alreadyResolved ? `, ${j.alreadyResolved} already resolved` : "")
        );
      }
    }
    setCollectTarget(null);
    fetchList(state.page);
  }

  async function performAdjust(opts: {
    paymentId: string;
    amountInr: number;
    reason: string | null;
  }) {
    const res = await fetch(
      `/api/admin/payments/${opts.paymentId}/adjust-total`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_inr: opts.amountInr,
          reason: opts.reason,
        }),
      }
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(j.error ?? "adjust failed");
    } else {
      flash(
        j.now_verified
          ? `total ₹${opts.amountInr} · paid in full`
          : `total ₹${opts.amountInr} · ₹${(j.remaining_inr ?? 0).toLocaleString("en-IN")} owed`
      );
    }
    setAdjustTarget(null);
    fetchList(state.page);
  }

  async function performReverse(opts: {
    paymentId: string;
    reason: string;
    all: boolean;
  }) {
    const res = await fetch(
      `/api/admin/payments/${opts.paymentId}/reverse`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: opts.reason,
          all: opts.all,
        }),
      }
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(j.error ?? "reverse failed");
    } else {
      flash(
        j.now_verified
          ? `reversed · still verified`
          : `reversed · back to pending (₹${(j.remaining_inr ?? 0).toLocaleString("en-IN")} owed)`
      );
    }
    setUndoTarget(null);
    fetchList(state.page);
  }

  async function bulkDelete() {
    if (state.selected.size === 0) return;
    if (!(await confirmDialog({ message: `Delete ${state.selected.size} registration(s)? Cannot be undone.`, confirmLabel: "Delete", tone: "danger" }))) return;
    const ids = [...state.selected];
    dispatch({ type: "remove", ids });
    const res = await fetch(`/api/admin/registrations/bulk`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(j.error ?? "bulk delete failed — refreshing");
      fetchList(state.page);
      return;
    }
    flash(`deleted ${j.deleted ?? 0}`);
    fetchList(state.page);
  }

  async function selectAllMatching() {
    const sp = new URLSearchParams();
    if (scope.eventId) sp.set("event_id", scope.eventId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (filters.division) sp.set("division", filters.division);
    if (filters.entry) sp.set("entry", filters.entry);
    if (filters.checkin) sp.set("checkin", filters.checkin);
    const res = await fetch(`/api/admin/registrations?${sp.toString()}`, {
      method: "POST",
    });
    const j = await res.json().catch(() => ({}));
    if (Array.isArray(j.ids)) {
      dispatch({ type: "select.set", ids: j.ids });
      flash(`selected ${j.ids.length} matching`);
    }
  }

  function viewProof(paymentId: string) {
    setProofModal({ paymentId });
  }

  // ─── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const inField =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "/" && !inField) {
        e.preventDefault();
        document.getElementById("regs-search-input")?.focus();
        return;
      }
      if (inField && e.key !== "Escape") return;
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        dispatch({ type: "select.clear" });
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        dispatch({ type: "cursor", cursor: Math.min(state.rows.length - 1, state.cursor + 1) });
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        dispatch({ type: "cursor", cursor: Math.max(0, state.cursor - 1) });
        return;
      }
      const cur = state.rows[state.cursor];
      if (e.key === "x" && cur) {
        e.preventDefault();
        dispatch({ type: "select.toggle", id: cur.id, allIds });
        return;
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "select.set", ids: allIds });
        return;
      }
      if (e.key === "v" && state.selected.size > 0) {
        e.preventDefault();
        bulkPaymentAction("verify");
        return;
      }
      if (e.key === "r" && state.selected.size > 0) {
        e.preventDefault();
        bulkPaymentAction("reject");
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && state.selected.size > 0) {
        e.preventDefault();
        bulkDelete();
        return;
      }
      if (e.key === "Enter" && cur) {
        const p = getPayment(cur);
        if (p?.proof_url) viewProof(p.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rows, state.cursor, state.selected, allIds]);

  const totalPages = Math.max(1, Math.ceil(state.total / pageSize));
  const exportParams = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        event_id: scope.eventId ?? "",
        q: debouncedQ,
        division: filters.division,
        entry: filters.entry,
        checkin: filters.checkin,
      }).filter(([, v]) => v)
    )
  ).toString();

  /**
   * Renders one athlete row. Extracted so flat and grouped views share
   * markup. `idx` is the row's position in `state.rows` so cursor + j/k
   * navigation work identically in both views.
   */
  function renderRow(r: Row, idx: number) {
    const p = getPayment(r);
    const isSel = state.selected.has(r.id);
    const isCur = idx === state.cursor;
    const inDistrictView = groupBy === "district";
    return (
      <tr
        key={r.id}
        data-row-idx={idx}
        onClick={() => dispatch({ type: "cursor", cursor: idx })}
        className={`h-[52px] border-b border-ink/10 last:border-b-0 align-top ${
          isSel ? "bg-rust/10" : isCur ? "bg-kraft/30" : "hover:bg-kraft/10"
        }`}
      >
        <td className="px-3 py-2">
          <input
            type="checkbox"
            aria-label={`Select ${r.full_name}`}
            checked={isSel}
            onChange={(e) =>
              dispatch({
                type: "select.toggle",
                id: r.id,
                range: (e.nativeEvent as MouseEvent).shiftKey,
                allIds,
              })
            }
          />
        </td>
        <td className="px-3 py-2 font-mono tabular-nums text-ink/60">
          {r.chest_no ?? "—"}
        </td>
        <td className="px-3 py-2">
          <p className="font-semibold leading-tight">
            {r.initial ? `${r.initial}. ` : ""}
            {r.full_name ?? "—"}
            {r.status === "disqualified" ? (
              <span className="ml-1.5 align-middle">
                <LifecyclePill kind="dq" />
              </span>
            ) : r.status === "withdrawn" ? (
              <span className="ml-1.5 align-middle">
                <LifecyclePill kind="withdrawn" />
              </span>
            ) : null}
          </p>
        </td>
        <td className="px-3 py-2 font-mono text-[13px]">{r.division ?? "—"}</td>
        <td className="px-3 py-2 font-mono text-[13px] text-ink/70">
          {inDistrictView
            ? (r.team ?? "—")
            : (r.district ?? r.team ?? "—")}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">
          {r.declared_weight_kg ?? "—"}
        </td>
        <td className="px-3 py-2 font-mono text-[13px]">
          <ClassesCell row={r} />
        </td>
        <td className="px-3 py-2">
          <CheckinPill status={r.checkin_status} />
        </td>
        <td className="px-3 py-2">
          <PaymentPill payment={p} />
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {p?.proof_url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  viewProof(p.id);
                }}
                className="border border-ink px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] hover:bg-kraft/30"
              >
                Proof
              </button>
            )}
            {p && p.status !== "rejected" && remainingInr(p) > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollectTarget({
                    kind: "single",
                    paymentId: p.id,
                    amount: remainingInr(p),
                    label: `${r.chest_no ? `${r.chest_no} · ` : ""}${r.full_name ?? ""}`,
                  });
                }}
                className="border border-ink bg-ink px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] text-bone hover:bg-rust"
              >
                Collect ₹{remainingInr(p).toLocaleString("en-IN")}
              </button>
            )}
            {p && (
              <RowActionsMenu
                payment={p}
                onAdjust={() => openAdjust(p)}
                onUndo={() => openUndo(p)}
              />
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
            {scope.eventId ? `Event · ${scope.eventName}` : "Across all events"}
          </p>
          <h1 className="mt-2 font-display text-5xl font-black tracking-tight">Registrations</h1>
          <p className="mt-1 font-mono text-[12px] text-ink/50">
            <kbd className="border border-ink/40 px-1">/</kbd> search ·{" "}
            <kbd className="border border-ink/40 px-1">j/k</kbd> move ·{" "}
            <kbd className="border border-ink/40 px-1">x</kbd> select ·{" "}
            <kbd className="border border-ink/40 px-1">v</kbd> verify ·{" "}
            <kbd className="border border-ink/40 px-1">r</kbd> reject ·{" "}
            <kbd className="border border-ink/40 px-1">Del</kbd> delete ·{" "}
            <kbd className="border border-ink/40 px-1">Enter</kbd> proof ·{" "}
            <kbd className="border border-ink/40 px-1">Esc</kbd> clear
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scope.eventId && (
            <PendingLink
              href={`/admin/events/${scope.eventSlug ?? scope.eventId}/counter`}
              prefetch
              className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust"
            >
              <span
                aria-hidden
                className="inline-flex h-4 w-4 items-center justify-center border border-current text-[12px] leading-none"
              >
                +
              </span>
              Counter desk
            </PendingLink>
          )}
          <a
            href={`/api/admin/registrations.csv?${exportParams}`}
            className="border-2 border-ink px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/30"
          >
            Export CSV ↓
          </a>
          {scope.eventId && (
            <PendingLink
              href={`/admin/events/${scope.eventSlug ?? scope.eventId}`}
              prefetch
              className="font-mono text-[12px] uppercase tracking-[0.2em] underline hover:text-rust"
            >
              ← event
            </PendingLink>
          )}
        </div>
      </div>

      {/* Filter bar — instant, no URL push */}
      <div className="flex flex-wrap items-end gap-3 border-2 border-ink p-3">
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Search</span>
          <input
            id="regs-search-input"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Name / mobile / district"
            className="mt-1 block w-72 border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Division</span>
          <select
            name="filter-division"
            value={filters.division}
            onChange={(e) => setFilters({ ...filters, division: e.target.value })}
            className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            <option value="">All</option>
            <option>Men</option>
            <option>Women</option>
            <option>Para Men</option>
            <option>Para Women</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Entry</span>
          <select
            name="filter-entry"
            value={filters.entry}
            onChange={(e) => setFilters({ ...filters, entry: e.target.value })}
            className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="disqualified">Disqualified</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Check-in</span>
          <select
            name="filter-checkin"
            value={filters.checkin}
            onChange={(e) => setFilters({ ...filters, checkin: e.target.value })}
            className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            <option value="">All</option>
            <option value="not_arrived">Not arrived</option>
            <option value="weighed_in">Weighed-in</option>
            <option value="no_show">No-show</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Payment</span>
          <select
            name="filter-payment"
            value={filters.payment}
            onChange={(e) => setFilters({ ...filters, payment: e.target.value })}
            className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          >
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {(filters.q || filters.division || filters.entry || filters.checkin || filters.payment) && (
          <button
            type="button"
            onClick={() => setFilters({ q: "", division: "", entry: "", checkin: "", payment: "" })}
            className="h-10 border-2 border-ink/30 px-3 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Clear
          </button>
        )}
        <label className="block">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em]">View</span>
          <div className="mt-1 flex border-2 border-ink">
            <button
              type="button"
              onClick={() => setGroupBy("none")}
              className={`px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                groupBy === "none" ? "bg-ink text-bone" : "bg-bone text-ink"
              }`}
            >
              Flat
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("district")}
              className={`border-l-2 border-ink px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                groupBy === "district" ? "bg-ink text-bone" : "bg-bone text-ink"
              }`}
            >
              By district
            </button>
          </div>
        </label>
        {groupBy === "district" && groups.length > 0 && (
          <div className="flex items-end gap-1">
            <button
              type="button"
              onClick={() =>
                setCollapsedKeys(new Set(groups.map((g) => g.key)))
              }
              className="h-10 border-2 border-ink/30 px-3 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
              title="Collapse every district group"
            >
              Collapse all
            </button>
            <button
              type="button"
              onClick={() => setCollapsedKeys(new Set())}
              className="h-10 border-2 border-ink/30 px-3 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
              title="Expand every district group"
            >
              Expand all
            </button>
          </div>
        )}
        <div className="ml-auto font-mono text-[12px] text-ink/50">
          {state.loading ? (
            <Spinner variant="inline" label="Loading" />
          ) : (
            `${state.total} matching`
          )}
        </div>
      </div>

      {/* Bulk action bar — sticky when active */}
      {state.selected.size > 0 && (
        <div className="sticky top-[56px] z-20 flex flex-wrap items-center gap-2 border-2 border-rust bg-rust/10 p-3">
          <span className="font-mono text-[13px] font-bold text-rust">
            {state.selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => bulkPaymentAction("verify")}
            disabled={selectedPaymentIds.length === 0}
            className="border-2 border-moss bg-moss px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-white disabled:opacity-40"
          >
            Verify ({selectedPaymentIds.length})
          </button>
          <button
            type="button"
            onClick={() => bulkPaymentAction("reject")}
            disabled={selectedPaymentIds.length === 0}
            className="border-2 border-rust px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-rust disabled:opacity-40"
          >
            Reject ({selectedPaymentIds.length})
          </button>
          <button
            type="button"
            onClick={() =>
              setCollectTarget({
                kind: "bulk",
                paymentIds: selectedCollectablePayments.map((p) => p.id),
                total: selectedCollectTotal,
                label: `${selectedCollectablePayments.length} athlete(s)`,
                defaultPayer: null,
              })
            }
            disabled={selectedCollectablePayments.length === 0}
            className="border-2 border-ink bg-ink px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
          >
            Collect ₹{selectedCollectTotal.toLocaleString("en-IN")} ({selectedCollectablePayments.length})
          </button>
          <button
            type="button"
            onClick={bulkDelete}
            className="border-2 border-rust bg-rust px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-white"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "select.clear" })}
            className="border-2 border-ink/40 px-3 py-1 font-mono text-[13px] uppercase tracking-[0.2em]"
          >
            Clear
          </button>
          {state.total > state.rows.length && (
            <button
              type="button"
              onClick={selectAllMatching}
              className="border-2 border-ink px-3 py-1 font-mono text-[13px] uppercase tracking-[0.2em] hover:bg-kraft/30"
            >
              Select all {state.total} matching
            </button>
          )}
          {state.flash && (
            <span className="ml-auto font-mono text-[13px] text-ink/70">{state.flash}</span>
          )}
        </div>
      )}
      {state.flash && state.selected.size === 0 && (
        <div className="border-2 border-moss bg-moss/10 p-2 font-mono text-[13px] text-moss">
          {state.flash}
        </div>
      )}

      {state.error && (
        <div className="border-2 border-rust bg-rust/10 p-3 font-mono text-[13px] text-rust">
          {state.error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[13px] text-ink/60">
        {groupBy === "district" ? (
          <>
            <div className="flex items-center gap-2">
              <span>
                Districts {groups.length === 0 ? 0 : (districtPage - 1) * districtsPerPage + 1}
                –
                {Math.min(districtPage * districtsPerPage, groups.length)} of {groups.length}
                {" · page "}
                {districtPage} / {districtTotalPages}
              </span>
              <label className="flex items-center gap-1">
                <span className="uppercase tracking-[0.2em] text-ink/50">Per page</span>
                <select
                  value={districtsPerPage}
                  onChange={(e) => setDistrictsPerPage(Number(e.target.value))}
                  className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
                >
                  {DISTRICT_PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="uppercase tracking-[0.2em] text-ink/50">Rows / district</span>
                <select
                  value={rowsPerDistrict}
                  onChange={(e) => setRowsPerDistrict(Number(e.target.value))}
                  className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
                >
                  {ROWS_PER_DISTRICT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n === 0 ? "All" : n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-[0.2em] text-ink/40">Districts</span>
              <button
                type="button"
                disabled={districtPage <= 1}
                onClick={() => setDistrictPage((p) => Math.max(1, p - 1))}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                ← prev
              </button>
              <button
                type="button"
                disabled={districtPage >= districtTotalPages}
                onClick={() => setDistrictPage((p) => Math.min(districtTotalPages, p + 1))}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                next →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span>
                Page {state.page} of {totalPages} · {state.rows.length} of {state.total}
              </span>
              <label className="flex items-center gap-1">
                <span className="uppercase tracking-[0.2em] text-ink/50">Per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={state.page <= 1 || state.loading}
                onClick={() => fetchList(state.page - 1)}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                ← prev
              </button>
              <button
                type="button"
                disabled={state.page >= totalPages || state.loading}
                onClick={() => fetchList(state.page + 1)}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                next →
              </button>
            </div>
          </>
        )}
      </div>

      <div className="border-2 border-ink">
        <table ref={tableRef} className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-14" />
            <col />
            <col className="w-24" />
            {groupBy !== "district" && <col className="w-32" />}
            <col className="w-14" />
            <col className="w-32" />
            <col className="w-28" />
            <col className="w-44" />
            <col className="w-44" />
          </colgroup>
          <thead className="sticky top-[60px] z-20 border-b-2 border-ink bg-kraft/95 text-left font-mono text-[12px] uppercase tracking-[0.2em] backdrop-blur-sm">
            <tr>
              <th className="w-8 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all rows on this page"
                  checked={allSelectedOnPage}
                  onChange={(e) =>
                    dispatch({
                      type: "select.set",
                      ids: e.target.checked
                        ? Array.from(new Set([...state.selected, ...allIds]))
                        : [...state.selected].filter((id) => !allIds.includes(id)),
                    })
                  }
                />
              </th>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Division</th>
              <th className="px-3 py-3">{groupBy === "district" ? "Team" : "District / Team"}</th>
              <th className="px-3 py-3 text-right">Wt</th>
              <th className="px-3 py-3">Classes</th>
              <th className="px-3 py-3">Check-in</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupBy === "district" && visibleGroups.length > 0
              ? visibleGroups.flatMap((g) => {
                  const groupRowIds = g.rows.map((r) => r.id);
                  const allSelectedInGroup = groupRowIds.every((id) =>
                    state.selected.has(id)
                  );
                  const isCollapsed = collapsedKeys.has(g.key);
                  // Distinct team count inside this district — surfaces the
                  // "1 district may contain N teams" reality without forcing
                  // the operator to expand the group to find out.
                  const teamCount = new Set(
                    g.rows
                      .map((r) => r.team)
                      .filter((t): t is string => !!t && t.trim().length > 0)
                  ).size;
                  // Per-district row pagination. rowsPerDistrict === 0 means
                  // "All" (no slicing).
                  const rowWindow =
                    rowsPerDistrict === 0
                      ? g.rows.length
                      : rowsPerDistrict;
                  const rowTotalPages =
                    rowWindow > 0
                      ? Math.max(1, Math.ceil(g.rows.length / rowWindow))
                      : 1;
                  const rowPage = Math.min(
                    rowTotalPages,
                    Math.max(1, districtRowPages[g.key] ?? 1)
                  );
                  const sliceStart =
                    rowsPerDistrict === 0 ? 0 : (rowPage - 1) * rowWindow;
                  const sliceEnd =
                    rowsPerDistrict === 0
                      ? g.rows.length
                      : sliceStart + rowWindow;
                  const visibleRows = g.rows.slice(sliceStart, sliceEnd);
                  return [
                    <tr
                      key={`group-${g.key}`}
                      className="border-y-2 border-ink bg-kraft"
                    >
                      <td className="border-l-4 border-rust px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Select all rows in ${g.label}`}
                          checked={allSelectedInGroup}
                          onChange={(e) =>
                            dispatch({
                              type: "select.set",
                              ids: e.target.checked
                                ? Array.from(
                                    new Set([...state.selected, ...groupRowIds])
                                  )
                                : [...state.selected].filter(
                                    (id) => !groupRowIds.includes(id)
                                  ),
                            })
                          }
                        />
                      </td>
                      <td colSpan={9} className="px-3 py-2 align-middle">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(g.key)}
                            aria-expanded={!isCollapsed}
                            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${g.label}`}
                            className="flex items-center gap-2 text-left hover:opacity-70"
                          >
                            <span
                              className={`inline-block font-mono text-sm leading-none transition-transform ${
                                isCollapsed ? "" : "rotate-90"
                              }`}
                              aria-hidden="true"
                            >
                              ▶
                            </span>
                            <span className="font-display text-base font-black uppercase tracking-tight leading-tight">
                              {g.label}
                            </span>
                          </button>
                          <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
                            {g.rows.length} athlete{g.rows.length === 1 ? "" : "s"}
                            {teamCount > 0 && (
                              <>
                                {" · "}
                                {teamCount} team{teamCount === 1 ? "" : "s"}
                              </>
                            )}
                          </span>
                          <span className="font-mono text-[13px] text-moss">
                            ₹{g.collectedInr.toLocaleString("en-IN")} collected
                          </span>
                          {g.pendingInr > 0 && (
                            <span className="font-mono text-[13px] text-rust">
                              ₹{g.pendingInr.toLocaleString("en-IN")} pending
                            </span>
                          )}
                          {g.collectablePayments.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setCollectTarget({
                                  kind: "bulk",
                                  paymentIds: g.collectablePayments.map((p) => p.id),
                                  total: g.pendingInr,
                                  label: `${g.label} · ${g.collectablePayments.length} athlete(s)`,
                                  defaultPayer: g.label,
                                })
                              }
                              className="ml-auto border-2 border-ink bg-ink px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust"
                            >
                              Collect ₹{g.pendingInr.toLocaleString("en-IN")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,
                    ...(isCollapsed
                      ? []
                      : visibleRows.map((r) => {
                          const idx = state.rows.indexOf(r);
                          return renderRow(r, idx);
                        })),
                    ...(!isCollapsed && rowTotalPages > 1
                      ? [
                          <tr
                            key={`group-${g.key}-pager`}
                            className="border-b-2 border-ink/30 bg-kraft/40"
                          >
                            <td colSpan={10} className="px-3 py-2">
                              <div className="flex flex-wrap items-center justify-end gap-2 font-mono text-[13px] text-ink/60">
                                <span>
                                  Rows {sliceStart + 1}–
                                  {Math.min(sliceEnd, g.rows.length)} of{" "}
                                  {g.rows.length} · page {rowPage} /{" "}
                                  {rowTotalPages}
                                </span>
                                <button
                                  type="button"
                                  disabled={rowPage <= 1}
                                  onClick={() =>
                                    setDistrictRowPage(g.key, rowPage - 1)
                                  }
                                  className="border border-ink px-2 py-0.5 uppercase tracking-[0.2em] disabled:opacity-30"
                                >
                                  ← prev
                                </button>
                                <button
                                  type="button"
                                  disabled={rowPage >= rowTotalPages}
                                  onClick={() =>
                                    setDistrictRowPage(g.key, rowPage + 1)
                                  }
                                  className="border border-ink px-2 py-0.5 uppercase tracking-[0.2em] disabled:opacity-30"
                                >
                                  next →
                                </button>
                              </div>
                            </td>
                          </tr>,
                        ]
                      : []),
                  ];
                })
              : state.rows.map((r, idx) => renderRow(r, idx))}
            {state.rows.length === 0 && !state.loading && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center font-mono text-[13px] text-ink/50"
                >
                  No registrations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 font-mono text-[13px] text-ink/60">
        {groupBy === "district" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {groups.length} district{groups.length === 1 ? "" : "s"} ·{" "}
              {state.total} registration{state.total === 1 ? "" : "s"} loaded
              {state.total >= DISTRICT_FETCH_SIZE && (
                <span className="text-rust"> (capped at {DISTRICT_FETCH_SIZE} — narrow filters)</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-[0.2em] text-ink/40">Districts</span>
              <span>
                {groups.length === 0 ? 0 : (districtPage - 1) * districtsPerPage + 1}
                –{Math.min(districtPage * districtsPerPage, groups.length)} of{" "}
                {groups.length}
              </span>
              <button
                type="button"
                disabled={districtPage <= 1}
                onClick={() => setDistrictPage((p) => Math.max(1, p - 1))}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                ← prev
              </button>
              <button
                type="button"
                disabled={districtPage >= districtTotalPages}
                onClick={() => setDistrictPage((p) => Math.min(districtTotalPages, p + 1))}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                next →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span>
                Page {state.page} of {totalPages} · {state.rows.length} of {state.total}
              </span>
              <label className="flex items-center gap-1">
                <span className="uppercase tracking-[0.2em] text-ink/50">Per page</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="border border-ink bg-bone px-2 py-1 font-mono text-[13px]"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={state.page <= 1 || state.loading}
                onClick={() => fetchList(state.page - 1)}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                ← prev
              </button>
              <button
                type="button"
                disabled={state.page >= totalPages || state.loading}
                onClick={() => fetchList(state.page + 1)}
                className="border border-ink px-3 py-1 uppercase tracking-[0.2em] disabled:opacity-30"
              >
                next →
              </button>
            </div>
          </div>
        )}
      </div>

      {proofModal &&
        (() => {
          const row = state.rows.find((r) => {
            const p = getPayment(r);
            return p?.id === proofModal.paymentId;
          });
          const p = row ? getPayment(row) : null;
          const caption = row
            ? `${row.chest_no ? `${row.chest_no} · ` : ""}${row.full_name ?? ""}${
                row.division ? ` · ${row.division}` : ""
              }`
            : undefined;
          return (
            <ProofReviewModal
              paymentId={proofModal.paymentId}
              caption={caption}
              initialStatus={p?.status ?? "pending"}
              onClose={() => setProofModal(null)}
              onResolved={(action) => {
                dispatch({
                  type: "patchPayment",
                  ids: [proofModal.paymentId],
                  patch: { status: action === "verify" ? "verified" : "rejected" },
                });
                if (action === "verify" && row && p && p.status !== "verified") {
                  dispatch({ type: "patch", ids: [row.id], patch: { status: "paid" } });
                }
                flash(`payment ${action === "verify" ? "verified" : "rejected"}`);
              }}
            />
          );
        })()}

      {collectTarget && (
        <CollectPopover
          target={collectTarget}
          onClose={() => setCollectTarget(null)}
          onConfirm={(opts) =>
            performCollect({
              paymentIds:
                collectTarget.kind === "single"
                  ? [collectTarget.paymentId]
                  : collectTarget.paymentIds,
              method: opts.method,
              reference: opts.reference,
              amountOverride:
                collectTarget.kind === "single" ? opts.amountOverride : null,
              waiveRemainder: opts.waiveRemainder,
              poolAmount: opts.poolAmount,
              payerLabel: opts.payerLabel,
            })
          }
        />
      )}
      {adjustTarget && (
        <AdjustTotalPopover
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onConfirm={(opts) =>
            performAdjust({
              paymentId: adjustTarget.paymentId,
              amountInr: opts.amountInr,
              reason: opts.reason,
            })
          }
        />
      )}
      {undoTarget && (
        <UndoCollectPopover
          target={undoTarget}
          onClose={() => setUndoTarget(null)}
          onConfirm={(opts) =>
            performReverse({
              paymentId: undoTarget.paymentId,
              reason: opts.reason,
              all: opts.all,
            })
          }
        />
      )}
    </div>
  );
}

function LifecyclePill({ kind }: { kind: "dq" | "withdrawn" }) {
  const cls =
    kind === "dq"
      ? "border-rust bg-rust text-white"
      : "border-ink/30 text-ink/40";
  return (
    <span
      className={`inline-block whitespace-nowrap border px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] ${cls}`}
    >
      {kind === "dq" ? "DQ" : "withdrawn"}
    </span>
  );
}

function CheckinPill({
  status,
}: {
  status: "not_arrived" | "weighed_in" | "no_show" | null | undefined;
}) {
  if (status === "weighed_in") {
    return (
      <span className="inline-block whitespace-nowrap border border-moss bg-moss px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] text-white">
        weighed-in
      </span>
    );
  }
  if (status === "no_show") {
    return (
      <span className="inline-block whitespace-nowrap border border-rust bg-rust px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] text-white">
        no-show
      </span>
    );
  }
  return <span className="font-mono text-[12px] text-ink/40">—</span>;
}

function PaymentPill({ payment }: { payment: Payment | null }) {
  if (!payment) return <span className="font-mono text-[12px] text-ink/40">—</span>;
  const collected = collectedInr(payment);
  const total = payment.amount_inr ?? 0;
  const remaining = Math.max(0, total - collected);
  const isPartial = collected > 0 && remaining > 0;
  // Surface the most recent payer label across active (non-reversed)
  // collections — that's what shows up as the "By Trichy DC" chip on
  // the row. Multiple distinct payers are a corner case (mixed pool +
  // self-pay); we just show the most recent for brevity.
  const payerLabel = (() => {
    const cols = payment.payment_collections ?? [];
    for (let i = cols.length - 1; i >= 0; i--) {
      const c = cols[i];
      if (c.reversed_at) continue;
      if (c.payer_label && c.payer_label.trim().length > 0) {
        return c.payer_label.trim();
      }
    }
    return null;
  })();
  const color =
    payment.status === "verified"
      ? "border-moss bg-moss text-white"
      : payment.status === "rejected"
        ? "border-rust bg-rust text-white"
        : isPartial
          ? "border-gold bg-gold text-ink"
          : payment.utr
            ? "border-rust text-rust"
            : "border-ink/30 text-ink/50";
  const label =
    payment.status === "verified"
      ? "verified"
      : payment.status === "rejected"
        ? "rejected"
        : isPartial
          ? "partial"
          : payment.utr
            ? "review"
            : "pending";
  // Method badge: cash / waiver are visually distinct from the default UPI
  // flow so an operator can tell at a glance how a row was settled.
  const methodLabel =
    payment.status === "verified"
      ? payment.method === "cash"
        ? "Cash"
        : payment.method === "waiver"
          ? "Waiver"
          : "UPI"
      : null;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-block whitespace-nowrap border px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] ${color}`}
        >
          {label}
        </span>
        {total > 0 && (
          <span className="font-mono text-[12px] tabular-nums text-ink/60">
            ₹{collected.toLocaleString("en-IN")}
            <span className="text-ink/40">{" / ₹"}{total.toLocaleString("en-IN")}</span>
          </span>
        )}
        {methodLabel && (
          <span className="inline-block border border-ink/30 px-1 font-mono text-[11px] uppercase tracking-[0.15em] text-ink/60">
            {methodLabel}
          </span>
        )}
        {payerLabel && (
          <span
            className="inline-block border border-ink/40 bg-kraft/30 px-1 font-mono text-[11px] uppercase tracking-[0.15em] text-ink/70"
            title={`Paid by ${payerLabel}`}
          >
            By {payerLabel}
          </span>
        )}
      </span>
      {payment.utr && (
        <span className="truncate font-mono text-[12px] text-ink/50" title={payment.utr}>
          {payment.utr}
        </span>
      )}
    </div>
  );
}

/**
 * "Collect ₹X" popover. Drives both single-row collection (with optional
 * amount override for concessions) and bulk-by-district collection (one
 * shared reference, e.g. "Trichy DC bundle 22-Apr").
 */
function CollectPopover({
  target,
  onClose,
  onConfirm,
}: {
  target:
    | { kind: "single"; paymentId: string; amount: number; label: string }
    | {
        kind: "bulk";
        paymentIds: string[];
        total: number;
        label: string;
        defaultPayer: string | null;
      };
  onClose: () => void;
  onConfirm: (opts: {
    method: "cash" | "manual_upi" | "waiver";
    reference: string | null;
    amountOverride: number | null;
    waiveRemainder: boolean;
    /** Bulk only — pool to spread oldest-first. null = "settle each remainder". */
    poolAmount: number | null;
    /** Bulk only — stamped on every created collection. */
    payerLabel: string | null;
  }) => void;
}) {
  const [method, setMethod] = useState<"cash" | "manual_upi" | "waiver">("cash");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(
    target.kind === "single" ? String(target.amount) : ""
  );
  const [waiveRemainder, setWaiveRemainder] = useState(false);
  // Bulk-only: pool amount (typed) + payer label (defaults to district / team name).
  const [poolAmount, setPoolAmount] = useState(
    target.kind === "bulk" ? String(target.total) : ""
  );
  const [payerLabel, setPayerLabel] = useState(
    target.kind === "bulk" ? target.defaultPayer ?? "" : ""
  );
  const total = target.kind === "single" ? target.amount : target.total;
  const typed = Number(amount) || 0;
  const willWaiveAmount =
    target.kind === "single" && waiveRemainder ? Math.max(0, total - typed) : 0;
  const poolNum = Number(poolAmount) || 0;
  const poolShortfall =
    target.kind === "bulk" && method !== "waiver"
      ? Math.max(0, total - poolNum)
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          {target.kind === "single" ? "Mark as collected" : "Bulk collect"}
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          Remaining balance{" "}
          <span className="font-bold text-ink">
            ₹{total.toLocaleString("en-IN")}
          </span>
          {target.kind === "bulk"
            ? " · type a smaller pool to auto-allocate oldest-first"
            : " · type a smaller amount for an installment"}
        </p>

        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Method
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-1 border-2 border-ink">
              {(
                [
                  ["cash", "Cash"],
                  ["manual_upi", "UPI"],
                  ["waiver", "Waiver"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMethod(v)}
                  className={`px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                    method === v ? "bg-ink text-bone" : "bg-bone text-ink hover:bg-kraft/30"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>

          {target.kind === "single" && method !== "waiver" && (
            <label className="block">
              <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                Amount (₹)
              </span>
              <input
                type="number"
                min={0}
                max={total}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block font-mono text-[12px] text-ink/50">
                Defaults to the full remainder. Type a smaller number to
                record an installment — the next collect will offer the
                rest.
              </span>
            </label>
          )}

          {target.kind === "single" && method !== "waiver" && total - typed > 0 && (
            <label className="flex items-start gap-2 border-2 border-dashed border-ink/30 bg-kraft/10 px-3 py-2">
              <input
                type="checkbox"
                checked={waiveRemainder}
                onChange={(e) => setWaiveRemainder(e.target.checked)}
                className="mt-0.5"
              />
              <span className="font-mono text-[13px] leading-snug text-ink/80">
                Waive the rest (₹{Math.max(0, total - typed).toLocaleString("en-IN")})
                <span className="block text-[12px] text-ink/50">
                  Closes the balance with a waiver collection so the
                  athlete shows as fully paid.
                </span>
              </span>
            </label>
          )}

          {target.kind === "bulk" && method !== "waiver" && (
            <>
              <label className="block">
                <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                  Pool amount (₹)
                </span>
                <input
                  type="number"
                  min={0}
                  value={poolAmount}
                  onChange={(e) => setPoolAmount(e.target.value)}
                  className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
                />
                <span className="mt-1 block font-mono text-[12px] text-ink/50">
                  Defaults to the full district balance. Lower it and we
                  auto-allocate oldest-first until it runs out.
                </span>
              </label>
              {poolShortfall > 0 && (
                <p className="border-2 border-gold bg-gold/10 px-3 py-2 font-mono text-[13px] leading-snug text-ink">
                  ⚠ Pool ₹{poolNum.toLocaleString("en-IN")} is short by ₹
                  {poolShortfall.toLocaleString("en-IN")}. Athletes are
                  settled oldest-first; the rest stay pending.
                </p>
              )}
              <label className="block">
                <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
                  Paid by
                </span>
                <input
                  type="text"
                  value={payerLabel}
                  onChange={(e) => setPayerLabel(e.target.value)}
                  placeholder="District or team name"
                  className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
                />
                <span className="mt-1 block font-mono text-[12px] text-ink/50">
                  Stamped on every collection so the row shows a small
                  "By {payerLabel || "…"}" chip.
                </span>
              </label>
              <label className="flex items-start gap-2 border-2 border-dashed border-ink/30 bg-kraft/10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={waiveRemainder}
                  onChange={(e) => setWaiveRemainder(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="font-mono text-[13px] leading-snug text-ink/80">
                  Treat any shortfall as a waiver per athlete.
                </span>
              </label>
            </>
          )}

          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reference / note
            </span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                target.kind === "bulk"
                  ? "e.g. Trichy DC · Mr. Selvam · 22-Apr · receipt #421"
                  : "e.g. cash receipt #018"
              }
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
            {target.kind === "bulk" && (
              <span className="mt-1 block font-mono text-[12px] text-ink/50">
                Same reference is recorded on every payment so you can
                find the bundle later in the audit log.
              </span>
            )}
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                method,
                reference: reference.trim() || null,
                amountOverride:
                  target.kind === "single" && method !== "waiver" && amount.trim().length > 0
                    ? Math.max(0, Number(amount) || 0)
                    : null,
                waiveRemainder,
                poolAmount:
                  target.kind === "bulk" && method !== "waiver" && poolAmount.trim().length > 0
                    ? Math.max(0, Number(poolAmount) || 0)
                    : null,
                payerLabel:
                  target.kind === "bulk" && payerLabel.trim().length > 0
                    ? payerLabel.trim()
                    : null,
              })
            }
            className="border-2 border-ink bg-ink px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust"
          >
            {method === "waiver"
              ? `Waive ₹${total.toLocaleString("en-IN")}`
              : waiveRemainder && willWaiveAmount > 0
                ? `Collect ₹${typed.toLocaleString("en-IN")} + waive ₹${willWaiveAmount.toLocaleString("en-IN")}`
                : target.kind === "bulk" && poolNum > 0 && poolNum < total
                  ? `Allocate ₹${poolNum.toLocaleString("en-IN")} oldest-first`
                  : `Confirm collect`}
          </button>
        </div>
      </div>
    </div>
  );
}

function handLabel(h: string | null | undefined): string {
  if (!h) return "";
  if (h === "B") return "R+L";
  return h;
}

function ClassesCell({ row }: { row: Row }) {
  const nonparaClasses = row.nonpara_classes ?? [];
  const nonparaHands = row.nonpara_hands ?? [];
  const fallbackHand = row.nonpara_hand ?? null;
  const paraCodes = row.para_codes ?? [];
  const paraHand = row.para_hand ?? null;

  const items: { label: string; hand: string }[] = [];
  nonparaClasses.forEach((cls, i) => {
    items.push({ label: cls, hand: handLabel(nonparaHands[i] ?? fallbackHand) });
  });
  paraCodes.forEach((code) => {
    items.push({ label: `Para ${code}`, hand: handLabel(paraHand) });
  });

  if (items.length === 0) {
    return (
      <span className="font-mono text-[12px] text-ink/40">
        {row.weight_class_code ?? "—"}
      </span>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="border border-ink/30 px-1.5 py-0.5 text-[12px] uppercase tracking-[0.15em]">
            {it.label}
          </span>
          {it.hand && (
            <span className="text-[12px] text-ink/60">{it.hand}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Per-row "..." menu giving operators access to less-common but
 * still-essential payment actions: change the total fee, undo a wrong
 * verification. Disabled actions render as muted text so the menu shape
 * stays predictable.
 */
function RowActionsMenu({
  payment,
  onAdjust,
  onUndo,
}: {
  payment: Payment;
  onAdjust: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const collected = collectedInr(payment);
  const canUndo = collected > 0;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Row actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="border border-ink/30 px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
      >
        ?
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 z-40 mt-1 w-44 border-2 border-ink bg-bone shadow-[4px_4px_0_0_rgba(10,27,20,0.9)]"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAdjust();
              }}
              className="block w-full px-3 py-2 text-left font-mono text-[13px] uppercase tracking-[0.2em] hover:bg-kraft/30"
            >
              Adjust total fee
            </button>
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => {
                setOpen(false);
                if (canUndo) onUndo();
              }}
              className="block w-full px-3 py-2 text-left font-mono text-[13px] uppercase tracking-[0.2em] hover:bg-kraft/30 disabled:cursor-not-allowed disabled:text-ink/30 disabled:hover:bg-bone"
              title={canUndo ? "Reverse the most recent collection" : "No active collections to reverse"}
            >
              Undo last collect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Modal � change payments.amount_inr. Used when the operator entered
 * the wrong total or the athlete's category set changed after the
 * payment was created. Server re-derives erified against existing
 * collections.
 */
function AdjustTotalPopover({
  target,
  onClose,
  onConfirm,
}: {
  target: { paymentId: string; currentTotal: number; collected: number; label: string };
  onClose: () => void;
  onConfirm: (opts: { amountInr: number; reason: string | null }) => void;
}) {
  const [amount, setAmount] = useState(String(target.currentTotal));
  const [reason, setReason] = useState("");
  const newTotal = Math.max(0, Number(amount) || 0);
  const newRemaining = Math.max(0, newTotal - target.collected);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
          Adjust total fee
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          ?{target.collected.toLocaleString("en-IN")} already collected.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              New total (?)
            </span>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block font-mono text-[12px] text-ink/50">
              {newTotal === target.collected
                ? "Will mark as fully paid."
                : newTotal > target.collected
                  ? `Will leave ₹${newRemaining.toLocaleString("en-IN")} pending.`
                  : "New total is below collected — refund flow not implemented; will still mark as fully paid."}
            </span>
          </label>
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. extra category added, fee correction"
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({ amountInr: newTotal, reason: reason.trim() || null })
            }
            className="border-2 border-ink bg-ink px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust"
          >
            Save total
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal � soft-reverse the most recent collection (or all of them).
 * Mandatory 
eason so the audit trail captures why an operator chose
 * to undo.
 */
function UndoCollectPopover({
  target,
  onClose,
  onConfirm,
}: {
  target: { paymentId: string; collected: number; label: string };
  onClose: () => void;
  onConfirm: (opts: { reason: string; all: boolean }) => void;
}) {
  const [reason, setReason] = useState("");
  const [all, setAll] = useState(false);
  const ok = reason.trim().length >= 3;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-bone p-6 shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-rust">
          Undo collection
        </p>
        <h3 className="mt-1 font-display text-2xl font-black tracking-tight">
          {target.label}
        </h3>
        <p className="mt-1 font-mono text-[13px] text-ink/60">
          Soft-reverses the {all ? "all collections" : "most recent collection"}. The row stays in the audit log.
        </p>

        <div className="mt-5 space-y-4">
          <label className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.2em] text-ink/80">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Reverse every active collection
          </label>
          <label className="block">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em]">
              Reason (required)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong athlete, double-counted, accidental verify"
              className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onConfirm({ reason: reason.trim(), all })}
            className="border-2 border-rust bg-rust px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reverse
          </button>
        </div>
      </div>
    </div>
  );
}
