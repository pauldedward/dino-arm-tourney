import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { resolveEventRef } from "@/lib/db/resolve-event";
import { isPaid } from "@/lib/payments/status";
import { signedUrl } from "@/lib/storage";
import PendingLink from "@/components/PendingLink";
import WeighInForm from "./WeighInForm";

export const dynamic = "force-dynamic";

export default async function WeighInDetailPage({
  params,
}: {
  params: Promise<{ id: string; regId: string }>;
}) {
  const { id: idOrSlug, regId } = await params;
  const ref = await resolveEventRef(idOrSlug);
  if (!ref) redirect("/admin/events?gone=event");
  const eventId = ref.id;
  const queueHref = `/admin/events/${ref.slug}/weighin`;
  await requireRole("operator", queueHref);

  const svc = createServiceClient();
  const { data: reg } = await svc
    .from("registrations")
    .select(
      "id, event_id, chest_no, full_name, initial, division, district, team, declared_weight_kg, weight_class_code, status, photo_url, events(name, id_card_event_title), payments(id, status, amount_inr)"
    )
    .eq("id", regId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!reg) redirect(`${queueHref}?gone=registration`);

  const { data: history } = await svc
    .from("weigh_ins")
    .select("id, measured_kg, weighed_at, live_photo_url")
    .eq("registration_id", regId)
    .order("weighed_at", { ascending: false });

  const event = Array.isArray(reg.events) ? reg.events[0] : reg.events;
  const payments = Array.isArray(reg.payments) ? reg.payments : [];
  const paymentVerified = isPaid(reg.status, payments);

  // Presign the current athlete photo (if any) so the operator can see
  // what's already on file before deciding to retake. Stored keys are
  // private — never expose the raw R2 path. Failures are non-fatal.
  let currentPhotoUrl: string | null = null;
  if (reg.photo_url && !/^https?:\/\//i.test(reg.photo_url)) {
    try {
      currentPhotoUrl = await signedUrl(reg.photo_url, 600);
    } catch {
      currentPhotoUrl = null;
    }
  } else if (reg.photo_url) {
    currentPhotoUrl = reg.photo_url;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">
            {event?.name ?? "Weigh-in"}
          </p>
          <h1 className="mt-2 font-display text-5xl font-black tracking-tight">
            {reg.chest_no ?? "—"} · {reg.initial ? `${reg.initial}. ` : ""}
            {reg.full_name ?? "—"}
          </h1>
          <p className="mt-2 font-mono text-xs text-ink/70">
            {reg.division} · {reg.district ?? reg.team ?? "—"} · declared{" "}
            <span className="tabular-nums">{reg.declared_weight_kg ?? "—"}</span> kg
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em]">
            <span
              className={`inline-block border px-1.5 py-0.5 ${
                paymentVerified
                  ? "border-moss/60 bg-moss/10 text-moss"
                  : "border-rust/60 bg-rust/10 text-rust"
              }`}
            >
              {paymentVerified ? "Payment ✓" : "Payment pending"}
            </span>
            {!paymentVerified && (
              <span className="ml-2 normal-case tracking-normal text-ink/60">
                Weigh-in is allowed; chase the dues separately.
              </span>
            )}
          </p>
        </div>
        <PendingLink
          href={queueHref}
          prefetch
          className="font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
        >
          ← queue
        </PendingLink>
      </div>

      <WeighInForm
        registrationId={regId}
        declared={reg.declared_weight_kg ?? null}
        queueHref={queueHref}
        currentPhotoUrl={currentPhotoUrl}
      />

      <section className="border-2 border-ink">
        <header className="border-b-2 border-ink bg-kraft/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.3em]">
          History ({history?.length ?? 0})
        </header>
        <div className="divide-y divide-ink/10">
          {(history ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="font-mono tabular-nums">{h.measured_kg} kg</span>
              <span className="font-mono text-[11px] text-ink/60">
                {h.weighed_at ? new Date(h.weighed_at).toLocaleString("en-IN") : ""}
              </span>
              {h.live_photo_url && (
                <a
                  href={h.live_photo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] underline hover:text-rust"
                >
                  photo ↗
                </a>
              )}
            </div>
          ))}
          {(!history || history.length === 0) && (
            <p className="px-3 py-4 font-mono text-xs text-ink/50">
              No weigh-in captures yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
