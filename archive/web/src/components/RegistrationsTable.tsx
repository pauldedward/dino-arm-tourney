"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

type Payment = { id: string; amount_inr: number; status: string; utr: string | null };
type Row = {
  id: string;
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  status: string;
  age_categories: string[] | null;
  mobile: string | null;
  photo_url: string | null;
  event_id?: string;
  events?: { name: string; slug: string } | null;
  payments?: Payment[];
};

export default function RegistrationsTable({
  rows,
  eventId,
  showEvent,
}: {
  rows: Row[];
  eventId?: string;
  showEvent?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const filtered = filter
    ? rows.filter((r) =>
        (r.full_name ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        String(r.chest_no ?? "").includes(filter) ||
        (r.mobile ?? "").includes(filter)
      )
    : rows;
  return (
    <div className="space-y-3">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name / chest / mobile…"
        className="w-full max-w-md border-2 border-ink bg-bone px-3 py-2 font-mono text-sm focus:bg-volt focus:outline-none"
      />
      <div className="border-2 border-ink overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-ink/5">
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em]">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Name</th>
              {showEvent && <th className="px-2 py-2">Event</th>}
              <th className="px-2 py-2">Div</th>
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2">Wt</th>
              <th className="px-2 py-2">District / Team</th>
              <th className="px-2 py-2">Mobile</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Payment</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const p = r.payments?.[0];
              return (
                <tr key={r.id} className="border-b border-ink/10 hover:bg-volt/30">
                  <td className="px-2 py-2 tnum font-bold">{r.chest_no}</td>
                  <td className="px-2 py-2">{r.full_name}</td>
                  {showEvent && (
                    <td className="px-2 py-2 font-mono text-xs">
                      {r.events?.slug ?? ""}
                    </td>
                  )}
                  <td className="px-2 py-2 font-mono text-xs">{r.division}</td>
                  <td className="px-2 py-2 font-mono text-xs">{(r.age_categories ?? []).join(", ")}</td>
                  <td className="px-2 py-2 tnum">{r.declared_weight_kg}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.district ?? r.team}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.mobile}</td>
                  <td className="px-2 py-2">
                    <span className="border border-ink px-1 font-mono text-[10px] uppercase">{r.status}</span>
                  </td>
                  <td className="px-2 py-2">
                    {p ? (
                      <PaymentCell payment={p} />
                    ) : (
                      <span className="font-mono text-[10px] text-ink/50">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      href={`/admin/registrations/${r.id}${eventId ? "" : ""}`}
                      className="font-mono text-xs underline hover:text-blood"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-2 py-8 text-center font-mono text-xs text-ink/60">
                  No registrations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentCell({ payment }: { payment: Payment }) {
  const [busy, start] = useTransition();
  const [status, setStatus] = useState(payment.status);
  async function call(action: "verify" | "reject") {
    start(async () => {
      const res = await fetch(`/api/payment/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: payment.id }),
      });
      const j = await res.json();
      if (j.ok) setStatus(action === "verify" ? "verified" : "rejected");
    });
  }
  if (status === "verified") return <span className="font-mono text-[10px]">✓ ₹{payment.amount_inr}</span>;
  if (status === "rejected") return <span className="font-mono text-[10px] text-blood">rejected</span>;
  if (status === "submitted") {
    return (
      <span className="flex gap-1">
        <button
          onClick={() => call("verify")}
          disabled={busy}
          className="border border-ink bg-volt px-1 font-mono text-[10px] uppercase"
        >
          ✓ verify
        </button>
        <button
          onClick={() => call("reject")}
          disabled={busy}
          className="border border-ink px-1 font-mono text-[10px] uppercase hover:bg-blood hover:text-bone"
        >
          ✗
        </button>
      </span>
    );
  }
  return <span className="font-mono text-[10px] text-ink/50">{status}</span>;
}
