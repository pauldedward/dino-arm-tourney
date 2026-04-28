/**
 * Human-readable formatting for audit_log rows.
 *
 * Every action emitted by `recordAudit({ action, payload })` should have a
 * matching entry here. Unknown actions fall back to a generic title-cased
 * label, so the UI never explodes on a new event type — but you should still
 * add it to the catalog so super admins get a useful summary line.
 */

export type AuditCategory =
  | "payment"
  | "registration"
  | "weighin"
  | "event"
  | "user"
  | "fixtures"
  | "export"
  | "system";

export interface ResolvedTargets {
  events: Map<string, { name: string; slug: string | null }>;
  profiles: Map<string, { label: string }>;
  registrations: Map<
    string,
    { name: string; chest_no: number | null; event_id: string | null }
  >;
  payments: Map<
    string,
    { amount_inr: number | null; registration_id: string | null }
  >;
}

export const EMPTY_TARGETS: ResolvedTargets = {
  events: new Map(),
  profiles: new Map(),
  registrations: new Map(),
  payments: new Map(),
};

export interface AuditRowLite {
  action: string;
  target_table: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
}

export interface ActionMeta {
  label: string;
  category: AuditCategory;
  summarize: (row: AuditRowLite, targets: ResolvedTargets) => string;
}

const CATALOG: Record<string, ActionMeta> = {
  // ── Payments ────────────────────────────────────────────────────────────
  "payment.verify": {
    label: "Payment verified",
    category: "payment",
    summarize: (r, t) => `Verified ${describePayment(r, t)}.`,
  },
  "payment.reject": {
    label: "Payment rejected",
    category: "payment",
    summarize: (r, t) => `Rejected ${describePayment(r, t)}.`,
  },
  "payment.collect": {
    label: "Payment collected (offline)",
    category: "payment",
    summarize: (r, t) => {
      const p = r.payload ?? {};
      const method = pickStr(p, "method") ?? "manual";
      // New payload uses `collected_total_inr` + a `collections[]` array;
      // legacy single-line payload used `amount_inr`. Fall back across both.
      const amt =
        pickNum(p, "collected_total_inr") ?? pickNum(p, "amount_inr");
      const ref = pickStr(p, "reference");
      const payer = pickStr(p, "payer_label");
      const ath = athleteFromRegId(pickStr(p, "registration_id"), t);
      const ref_s = ref ? ` · ref ${ref}` : "";
      const payer_s = payer ? ` · paid by ${payer}` : "";
      return `Collected ${rupees(amt)} via ${methodLabel(method)} for ${ath}${ref_s}${payer_s}.`;
    },
  },
  "payment.proof_submitted": {
    label: "UPI proof submitted",
    category: "payment",
    summarize: (r, t) => {
      const tail = pickStr(r.payload ?? {}, "utr_tail");
      const ath = athleteFromPaymentTarget(r, t);
      return `Athlete ${ath} submitted UPI proof${tail ? ` (UTR ⋯${tail})` : ""}.`;
    },
  },
  "payment.proof_deleted": {
    label: "UPI proof removed",
    category: "payment",
    summarize: (r, t) => {
      const tail = pickStr(r.payload ?? {}, "utr_tail");
      const ath = athleteFromPaymentTarget(r, t);
      return `Removed UPI proof${tail ? ` (UTR ⋯${tail})` : ""} for ${ath}.`;
    },
  },

  "payment.adjust_total": {
    label: "Payment total adjusted",
    category: "payment",
    summarize: (r, t) => {
      const p = r.payload ?? {};
      const from = pickNum(p, "from_inr");
      const to = pickNum(p, "to_inr");
      const ath = athleteFromPaymentTarget(r, t);
      return `Adjusted total fee for ${ath}: ₹${from ?? "?"} → ₹${to ?? "?"}.`;
    },
  },
  "payment.reverse": {
    label: "Payment collection reversed",
    category: "payment",
    summarize: (r, t) => {
      const p = r.payload ?? {};
      const ids = Array.isArray(p.reversed_collection_ids)
        ? p.reversed_collection_ids.length
        : 1;
      const reason = pickStr(p, "reason");
      const ath = athleteFromPaymentTarget(r, t);
      return `Reversed ${ids} collection${ids === 1 ? "" : "s"} on ${ath}${
        reason ? ` — ${reason}` : ""
      }.`;
    },
  },

  // ── Weigh-in ────────────────────────────────────────────────────────────
  "weighin.record": {
    label: "Weigh-in recorded",
    category: "weighin",
    summarize: (r, t) => {
      const p = r.payload ?? {};
      const kg = pickNum(p, "measured_kg");
      const ath = athleteFromRegId(pickStr(p, "registration_id"), t);
      return `${ath} weighed in at ${kg != null ? `${kg} kg` : "(unknown)"}.`;
    },
  },

  // ── Events ──────────────────────────────────────────────────────────────
  "event.create": {
    label: "Event created",
    category: "event",
    summarize: (r) => {
      const p = r.payload ?? {};
      const name = pickStr(p, "name");
      const slug = pickStr(p, "slug");
      return name ? `Created event “${name}”${slug ? ` (${slug})` : ""}.` : "Created an event.";
    },
  },
  "event.update": {
    label: "Event edited",
    category: "event",
    summarize: (r, t) => {
      const fields = Object.keys(r.payload ?? {});
      const name = eventName(r.target_id, t);
      if (fields.length === 0) return `Edited ${name}.`;
      const preview = fields.slice(0, 3).join(", ");
      const more = fields.length > 3 ? ` +${fields.length - 3} more` : "";
      return `Edited ${name} — fields: ${preview}${more}.`;
    },
  },
  "event.publish": eventLifecycle("Published", "publish"),
  "event.unpublish": eventLifecycle("Unpublished", "unpublish"),
  "event.close_registrations": eventLifecycle("Closed registrations on", "close_registrations"),
  "event.reopen": eventLifecycle("Re-opened registrations on", "reopen"),
  "event.archive": eventLifecycle("Archived", "archive"),

  // ── Users ───────────────────────────────────────────────────────────────
  "user.role_change": {
    label: "User role changed",
    category: "user",
    summarize: (r, t) => {
      const p = r.payload ?? {};
      const from = pickStr(p, "from") ?? "?";
      const to = pickStr(p, "to") ?? "?";
      const who = profileName(r.target_id, t);
      return `Changed ${who}: ${roleLabel(from)} → ${roleLabel(to)}.`;
    },
  },
  "user.disable": {
    label: "User disabled",
    category: "user",
    summarize: (r, t) => `Disabled ${profileName(r.target_id, t)}.`,
  },
  "user.reenable": {
    label: "User re-enabled",
    category: "user",
    summarize: (r, t) => `Re-enabled ${profileName(r.target_id, t)}.`,
  },
  "user.promote_super": {
    label: "Super-admin granted",
    category: "user",
    summarize: (r, t) => `Promoted ${profileName(r.target_id, t)} to super admin.`,
  },

  // ── Fixtures ────────────────────────────────────────────────────────────
  "fixtures.generate": {
    label: "Brackets generated",
    category: "fixtures",
    summarize: (r) => {
      const p = r.payload ?? {};
      const cats = pickNum(p, "categories") ?? 0;
      const ents = pickNum(p, "entries") ?? 0;
      const fx = pickNum(p, "fixtures") ?? 0;
      const fmt = pickStr(p, "bracket_format");
      return `Built ${fx} match${fx === 1 ? "" : "es"} across ${cats} categor${cats === 1 ? "y" : "ies"} (${ents} entries${fmt ? `, ${fmt}` : ""}).`;
    },
  },

  // ── Exports ─────────────────────────────────────────────────────────────
  "xlsx.nominal.zip": {
    label: "Nominal roll exported",
    category: "export",
    summarize: (r) => {
      const p = r.payload ?? {};
      const d = pickNum(p, "districts") ?? 0;
      const tm = pickNum(p, "teams") ?? 0;
      const rows = pickNum(p, "rows") ?? 0;
      return `Downloaded nominal-roll ZIP — ${rows} athletes, ${d} districts, ${tm} teams.`;
    },
  },
};

export function describeAction(row: AuditRowLite, targets: ResolvedTargets): {
  label: string;
  category: AuditCategory;
  summary: string;
} {
  const meta = CATALOG[row.action];
  if (meta) {
    return {
      label: meta.label,
      category: meta.category,
      summary: meta.summarize(row, targets),
    };
  }
  // Fallback: synthesize from the action key.
  const [head] = row.action.split(".");
  return {
    label: titleCase(row.action.replace(/[._]/g, " ")),
    category: (head as AuditCategory) in CATEGORY_STYLE ? (head as AuditCategory) : "system",
    summary: row.target_table
      ? `Affected ${row.target_table} ${shortId(row.target_id)}.`
      : "No additional details.",
  };
}

// ── Category styling (consumed by the page) ─────────────────────────────────

export const CATEGORY_STYLE: Record<
  AuditCategory,
  { label: string; band: string; chip: string; glyph: string }
> = {
  payment: {
    label: "Payment",
    band: "border-l-moss",
    chip: "bg-moss text-bone",
    glyph: "₹",
  },
  registration: {
    label: "Registration",
    band: "border-l-ink",
    chip: "bg-ink text-bone",
    glyph: "✎",
  },
  weighin: {
    label: "Weigh-in",
    band: "border-l-gold",
    chip: "bg-gold text-ink",
    glyph: "⚖",
  },
  event: {
    label: "Event",
    band: "border-l-rust",
    chip: "bg-rust text-bone",
    glyph: "★",
  },
  user: {
    label: "User",
    band: "border-l-kraft",
    chip: "bg-kraft text-ink",
    glyph: "◉",
  },
  fixtures: {
    label: "Brackets",
    band: "border-l-ink",
    chip: "bg-ink text-bone",
    glyph: "▦",
  },
  export: {
    label: "Export",
    band: "border-l-kraft",
    chip: "bg-kraft text-ink",
    glyph: "↓",
  },
  system: {
    label: "System",
    band: "border-l-ink/40",
    chip: "bg-ink/20 text-ink",
    glyph: "·",
  },
};

// ── Catalog accessor for the filter bar ────────────────────────────────────

export interface CatalogEntry {
  action: string;
  label: string;
  category: AuditCategory;
}

export function listCatalog(): CatalogEntry[] {
  return Object.entries(CATALOG)
    .map(([action, m]) => ({ action, label: m.label, category: m.category }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
    );
}

// ── Time helpers ────────────────────────────────────────────────────────────

export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const diff = (now.getTime() - t) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = startOfDay(now);
  const that = startOfDay(d);
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: today.getFullYear() === d.getFullYear() ? undefined : "numeric",
  });
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ── Internals ───────────────────────────────────────────────────────────────

function eventLifecycle(verb: string, _action: string): ActionMeta {
  return {
    label: `Event ${verb.toLowerCase()}`,
    category: "event",
    summarize: (r, t) => `${verb} ${eventName(r.target_id, t)}.`,
  };
}

function eventName(id: string | null, t: ResolvedTargets): string {
  if (!id) return "an event";
  const ev = t.events.get(id);
  return ev ? `“${ev.name}”` : `event ${shortId(id)}`;
}

function profileName(id: string | null, t: ResolvedTargets): string {
  if (!id) return "a user";
  return t.profiles.get(id)?.label ?? `user ${shortId(id)}`;
}

function athleteFromRegId(
  regId: string | null | undefined,
  t: ResolvedTargets
): string {
  if (!regId) return "an athlete";
  const reg = t.registrations.get(regId);
  if (!reg) return `athlete ${shortId(regId)}`;
  const chest = reg.chest_no != null ? ` ${reg.chest_no}` : "";
  return `${reg.name}${chest}`;
}

function describePayment(r: AuditRowLite, t: ResolvedTargets): string {
  const p = r.payload ?? {};
  const regId =
    pickStr(p, "registration_id") ??
    (r.target_table === "payments" && r.target_id
      ? t.payments.get(r.target_id)?.registration_id ?? null
      : null);
  const ath = athleteFromRegId(regId, t);
  const amt =
    r.target_table === "payments" && r.target_id
      ? t.payments.get(r.target_id)?.amount_inr ?? null
      : null;
  return amt != null ? `${rupees(amt)} from ${ath}` : `payment from ${ath}`;
}

function athleteFromPaymentTarget(
  r: AuditRowLite,
  t: ResolvedTargets
): string {
  if (r.target_table === "payments" && r.target_id) {
    const pay = t.payments.get(r.target_id);
    return athleteFromRegId(pay?.registration_id ?? null, t);
  }
  return athleteFromRegId(pickStr(r.payload ?? {}, "registration_id"), t);
}

function rupees(n: number | null | undefined): string {
  if (n == null) return "₹—";
  return `₹${n.toLocaleString("en-IN")}`;
}

function methodLabel(m: string): string {
  switch (m) {
    case "cash":
      return "cash";
    case "manual_upi":
      return "manual UPI";
    case "waiver":
      return "waiver";
    default:
      return m;
  }
}

function roleLabel(r: string): string {
  switch (r) {
    case "super_admin":
      return "super admin";
    case "operator":
      return "operator";
    case "athlete":
      return "athlete";
    default:
      return r;
  }
}

function pickStr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNum(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
