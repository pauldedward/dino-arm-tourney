import "server-only";
import { createServiceClient } from "@/lib/db/supabase-service";
import type { ResolvedTargets, AuditRowLite } from "@/lib/audit-format";

/**
 * Batch-fetch the human labels for every distinct target referenced by a
 * page of audit rows. One round-trip per affected table (max 5), all in
 * parallel — bounded because each page is at most 200 rows.
 *
 * Inputs are taken straight from the audit_log row + payload so we cover
 * both `target_table:target_id` and the common `payload.registration_id`
 * pattern emitted by weigh-in / payment.collect / etc.
 */
export async function resolveAuditTargets(
  rows: AuditRowLite[] & { actor_id?: string | null }[]
): Promise<ResolvedTargets> {
  const eventIds = new Set<string>();
  const profileIds = new Set<string>();
  const registrationIds = new Set<string>();
  const paymentIds = new Set<string>();

  for (const r of rows) {
    if (r.target_id && r.target_table) {
      switch (r.target_table) {
        case "events":
          eventIds.add(r.target_id);
          break;
        case "profiles":
          profileIds.add(r.target_id);
          break;
        case "registrations":
          registrationIds.add(r.target_id);
          break;
        case "payments":
          paymentIds.add(r.target_id);
          break;
      }
    }
    const p = r.payload ?? {};
    const regId = p["registration_id"];
    if (typeof regId === "string") registrationIds.add(regId);
    const payId = p["payment_id"];
    if (typeof payId === "string") paymentIds.add(payId);
  }

  const svc = createServiceClient();

  const [evs, profs, regs, pays] = await Promise.all([
    eventIds.size
      ? svc
          .from("events")
          .select("id, name, slug")
          .in("id", [...eventIds])
      : Promise.resolve({ data: [] }),
    profileIds.size
      ? svc
          .from("profiles")
          .select("id, full_name, email")
          .in("id", [...profileIds])
      : Promise.resolve({ data: [] }),
    registrationIds.size
      ? svc
          .from("registrations")
          .select("id, full_name, chest_no, event_id")
          .in("id", [...registrationIds])
      : Promise.resolve({ data: [] }),
    paymentIds.size
      ? svc
          .from("payments")
          .select("id, amount_inr, registration_id")
          .in("id", [...paymentIds])
      : Promise.resolve({ data: [] }),
  ]);

  const targets: ResolvedTargets = {
    events: new Map(),
    profiles: new Map(),
    registrations: new Map(),
    payments: new Map(),
  };

  for (const e of (evs.data ?? []) as Array<{
    id: string;
    name: string;
    slug: string | null;
  }>) {
    targets.events.set(e.id, { name: e.name, slug: e.slug });
  }
  for (const p of (profs.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    targets.profiles.set(p.id, {
      label: p.full_name ?? p.email ?? p.id.slice(0, 8),
    });
  }
  for (const r of (regs.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    chest_no: number | null;
    event_id: string | null;
  }>) {
    targets.registrations.set(r.id, {
      name: r.full_name ?? "(unnamed)",
      chest_no: r.chest_no,
      event_id: r.event_id,
    });
  }
  for (const p of (pays.data ?? []) as Array<{
    id: string;
    amount_inr: number | null;
    registration_id: string | null;
  }>) {
    targets.payments.set(p.id, {
      amount_inr: p.amount_inr,
      registration_id: p.registration_id,
    });
  }

  // Second pass: payments target may have surfaced new registration ids that
  // we didn't see in the first scan (e.g. payment.verify with no payload reg).
  // Resolve them in one extra round-trip if needed.
  const extraRegs: string[] = [];
  for (const pay of targets.payments.values()) {
    if (pay.registration_id && !targets.registrations.has(pay.registration_id)) {
      extraRegs.push(pay.registration_id);
    }
  }
  if (extraRegs.length > 0) {
    const { data } = await svc
      .from("registrations")
      .select("id, full_name, chest_no, event_id")
      .in("id", extraRegs);
    for (const r of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      chest_no: number | null;
      event_id: string | null;
    }>) {
      targets.registrations.set(r.id, {
        name: r.full_name ?? "(unnamed)",
        chest_no: r.chest_no,
        event_id: r.event_id,
      });
    }
  }

  return targets;
}
