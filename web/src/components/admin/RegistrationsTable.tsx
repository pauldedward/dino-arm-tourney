import Link from "next/link";
import { createServiceClient } from "@/lib/db/supabase-service";
import { paymentDisplay } from "@/lib/payments/status";
import RegistrationsFilterBar from "./RegistrationsFilterBar";
import PaymentActions from "./PaymentActions";
import DeleteRegistrationButton from "./DeleteRegistrationButton";

interface Scope {
  eventId: string | null;
  eventName?: string;
  eventSlug?: string;
}

interface Filters {
  q: string;
  division: string;
  status: string;
}

/**
 * Shared server-rendered table for /admin/events/[id]/registrations.
 * Filters are URL query params so deep links work; a tiny client
 * component below updates the URL.
 */
export default async function RegistrationsTable({
  scope,
  filters,
}: {
  scope: Scope;
  filters: Filters;
}) {
  const svc = createServiceClient();

  let query = svc
    .from("registrations")
    .select(
      "id, event_id, chest_no, full_name, initial, division, district, team, declared_weight_kg, weight_class_code, status, created_at, photo_url, payments(id, amount_inr, status, utr, proof_url, verified_at)"
    )
    .order("chest_no", { ascending: true, nullsFirst: false })
    .limit(500);

  if (scope.eventId) query = query.eq("event_id", scope.eventId);
  if (filters.division) query = query.eq("division", filters.division);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      query = query.or(
        `full_name.ilike.%${q}%,mobile.ilike.%${q}%,district.ilike.%${q}%`
      );
    }
  }

  const { data: rows, error } = await query;

  const exportParams = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        event_id: scope.eventId ?? "",
        q: filters.q,
        division: filters.division,
        status: filters.status,
      }).filter(([, v]) => v)
    )
  ).toString();
  const csvHref = `/api/admin/registrations.csv?${exportParams}`;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
            {scope.eventId ? `Event · ${scope.eventName}` : "Across all events"}
          </p>
          <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
            Registrations
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={csvHref}
            className="border-2 border-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-kraft/30"
          >
            Export CSV ↓
          </a>
          {scope.eventId && (
            <Link
              href={`/admin/events/${scope.eventSlug ?? scope.eventId}`}
              className="font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
            >
              ← event
            </Link>
          )}
        </div>
      </div>

      <RegistrationsFilterBar initial={filters} />

      {error && (
        <div className="border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
          {error.message}
        </div>
      )}

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-kraft/20 text-left font-mono text-[10px] uppercase tracking-[0.2em]">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Division</th>
              <th className="px-3 py-3">District / Team</th>
              <th className="px-3 py-3 text-right">Weight</th>
              <th className="px-3 py-3">Class</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const payment = Array.isArray(r.payments) ? r.payments[0] : null;
              return (
                <tr key={r.id} className="border-b border-ink/10 last:border-b-0 hover:bg-kraft/10">
                  <td className="px-3 py-2 font-mono tabular-nums text-ink/60">
                    {r.chest_no ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">
                      {r.initial ? `${r.initial}. ` : ""}
                      {r.full_name ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.division ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink/70">
                    {r.district ?? r.team ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.declared_weight_kg ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.weight_class_code ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status ?? "submitted"} />
                  </td>
                  <td className="px-3 py-2">
                    <PaymentPill payment={payment} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-col items-end gap-1">
                      {payment && (payment.proof_url || payment.utr) && (
                        <PaymentActions
                          paymentId={payment.id}
                          status={payment.status}
                          hasProof={!!payment.proof_url}
                        />
                      )}
                      <DeleteRegistrationButton
                        registrationId={r.id}
                        label={`${r.initial ? r.initial + ". " : ""}${r.full_name ?? "athlete"}`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center font-mono text-xs text-ink/50">
                  No registrations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-ink/40">
        Showing up to 500 rows. Use filters to narrow.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = {
    pending: "border-ink/30 text-ink/70",
    paid: "border-moss bg-moss text-white",
    weighed_in: "border-moss text-moss",
    withdrawn: "border-ink/30 text-ink/40",
    disqualified: "border-rust bg-rust text-white",
  };
  return (
    <span
      className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
        m[status] ?? m.pending
      }`}
    >
      {status}
    </span>
  );
}

function PaymentPill({
  payment,
}: {
  payment: { amount_inr: number | null; status: string; utr: string | null } | null;
}) {
  if (!payment) return <span className="font-mono text-[10px] text-ink/40">—</span>;
  const display = paymentDisplay(payment);
  const color =
    display.tone === "ok"
      ? "border-moss bg-moss text-white"
      : display.tone === "bad"
        ? "border-rust bg-rust text-white"
        : display.tone === "warn"
          ? "border-rust text-rust"
          : "border-ink/30 text-ink/50";
  const label = display.label;
  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${color}`}>
        {label}
      </span>
      {payment.utr && (
        <span className="font-mono text-[10px] text-ink/50">UTR {payment.utr}</span>
      )}
    </div>
  );
}
