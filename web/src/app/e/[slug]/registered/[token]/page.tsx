import { redirect } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import { buildUpiUri } from "@/lib/registration";
import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";
import PaymentProofForm from "./PaymentProofForm";
import LiveRefresh from "@/components/LiveRefresh";
import PendingLink from "@/components/PendingLink";

export const dynamic = "force-dynamic";

/**
 * Thank-you page. No photo (PLAN §1.5 rule 3 — saves R2 class-B ops).
 * Shows:
 *   - chest number
 *   - payment state (pending / verified / rejected)
 *   - UPI deep-link + QR using the event's upi_id
 *   - inputs for UTR + screenshot upload when still pending
 */
export default async function RegisteredPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const svc = createServiceClient();
  const supa = await createClient();

  // Reg, event (by slug — independent of reg.event_id), and auth user
  // are all independent — fetch in parallel to halve perceived latency.
  const [regRes, eventRes, userRes] = await Promise.all([
    svc
      .from("registrations")
      .select("id, public_token, chest_no, full_name, initial, division, status, lifecycle_status, discipline_status, declared_weight_kg, event_id, athlete_id, gender, nonpara_classes, nonpara_hands, para_codes, para_hand, weight_overrides")
      .eq("public_token", token)
      .maybeSingle(),
    svc
      .from("events")
      .select("id, slug, name, primary_color, accent_color, text_on_primary, entry_fee_default_inr, upi_id, upi_payee_name, payment_mode, id_card_org_name, registration_published_at, registration_closed_at")
      .eq("slug", slug)
      .maybeSingle(),
    supa.auth.getUser(),
  ]);

  const reg = regRes.data;
  // Registration was deleted (or token is bogus): bounce back to the event
  // page with a flash banner instead of a hard 404.
  if (!reg) redirect(`/e/${slug}?gone=registration`);

  const event = eventRes.data;
  if (!event) redirect("/?gone=event");
  // Token belongs to a different event than the slug in the URL — fix URL.
  if (reg.event_id !== event.id) redirect(`/e/${slug}?gone=registration`);

  const {
    data: { user },
  } = userRes;
  const isOwner = !!user && user.id === reg.athlete_id;
  const now = Date.now();
  const opensAt = event.registration_published_at
    ? new Date(event.registration_published_at).getTime()
    : null;
  const closesAt = event.registration_closed_at
    ? new Date(event.registration_closed_at).getTime()
    : null;
  const regOpen =
    opensAt !== null && opensAt <= now && (closesAt === null || closesAt > now);

  // Payment + latest weigh-in are independent — fetch in parallel.
  const [paymentRes, weighInRes] = await Promise.all([
    svc
      .from("payments")
      .select("id, amount_inr, status, utr, proof_url, verified_at")
      .eq("registration_id", reg.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    svc
      .from("weigh_ins")
      .select("measured_kg, weighed_at, weighed_by")
      .eq("registration_id", reg.id)
      .order("weighed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const payment = paymentRes.data;
  const weighIn = weighInRes.data;

  let weigherName: string | null = null;
  if (weighIn?.weighed_by) {
    const { data: prof } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", weighIn.weighed_by)
      .maybeSingle();
    weigherName = prof?.full_name ?? "Deleted user";
  } else if (weighIn?.weighed_at) {
    // Weigh-in happened but the operator who performed it has been deleted
    // (FK SET NULL). Show a stable placeholder.
    weigherName = "Deleted user";
  }

  // Compute eligibility: which categories the athlete actually qualifies
  // for at their measured weight. We also compute what they intended at
  // declared weight so we can show "missed weight" for any category that
  // dropped off.
  const refYear = new Date().getUTCFullYear();
  const regLite: RegistrationLite = {
    id: reg.id,
    gender: (reg.gender as "M" | "F") ?? "M",
    declared_weight_kg: Number(reg.declared_weight_kg ?? 0),
    nonpara_classes: (reg.nonpara_classes as string[] | null) ?? [],
    nonpara_hands:
      (reg.nonpara_hands as RegistrationLite["nonpara_hands"]) ?? null,
    para_codes: (reg.para_codes as string[] | null) ?? [],
    para_hand: (reg.para_hand as RegistrationLite["para_hand"]) ?? null,
    weight_overrides:
      (reg.weight_overrides as RegistrationLite["weight_overrides"]) ?? null,
  };
  const declaredEntries = resolveEntries(regLite, null, refYear);
  const eligibleEntries = weighIn
    ? resolveEntries(
        regLite,
        { measured_kg: Number(weighIn.measured_kg) },
        refYear
      )
    : [];
  const eligibleCodes = new Set(eligibleEntries.map((e) => e.category_code));
  const droppedEntries = weighIn
    ? declaredEntries.filter((e) => !eligibleCodes.has(e.category_code))
    : [];

  const competing =
    reg.lifecycle_status !== "withdrawn" &&
    reg.discipline_status !== "disqualified" &&
    // Tolerate pre-0039 rows that only have the legacy mirror.
    reg.status !== "withdrawn" &&
    reg.status !== "disqualified";
  const canEdit =
    isOwner &&
    regOpen &&
    competing &&
    payment?.status !== "verified";

  // All proofs the athlete has uploaded against this payment so far.
  // Athletes can pay in multiple instalments; each UPI transfer gets its
  // own proof row with its own UTR.
  const { data: proofs } = payment
    ? await svc
        .from("payment_proofs")
        .select("id, utr, proof_url, created_at")
        .eq("payment_id", payment.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const amount = payment?.amount_inr ?? event.entry_fee_default_inr ?? 0;
  const paymentMode =
    (event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ??
    "online_upi";
  // Show the UPI block when the event accepts UPI (online_upi or hybrid) and
  // there is something to pay. Pure-offline events skip the QR entirely.
  const onlinePaymentEnabled = amount > 0 && paymentMode !== "offline";
  const offlinePaymentExpected = amount > 0 && paymentMode !== "online_upi";
  const upiId = event.upi_id ?? "tnawa@okhdfc";
  const payee = event.upi_payee_name ?? event.id_card_org_name ?? "TNAWA";
  const note = `CHEST${String(reg.chest_no ?? 0).padStart(4, "0")} ${reg.full_name ?? ""}`.trim();
  const upiUri = onlinePaymentEnabled
    ? buildUpiUri({
        upiId,
        payeeName: payee,
        amountInr: amount,
        note,
      })
    : "";
  const qrDataUrl = onlinePaymentEnabled
    ? await QRCode.toDataURL(upiUri, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: "M",
      })
    : "";

  const primary = event.primary_color ?? "#0f3d2e";
  const accent = event.accent_color ?? "#f5c518";
  const onPrimary = event.text_on_primary ?? "#ffffff";

  const statusLabel =
    payment?.status === "verified"
      ? "Verified — see you at weigh-in"
      : payment?.status === "rejected"
        ? "Rejected — please re-submit UTR"
        : payment?.utr
          ? "Under review"
          : onlinePaymentEnabled
            ? "Awaiting payment"
            : offlinePaymentExpected
              ? "Registered — pay at counter"
              : "Registered";;

  return (
    <main
      className="min-h-screen"
      style={{ background: primary, color: onPrimary }}
    >
      <LiveRefresh tables={["registrations", "payments", "payment_proofs", "weigh_ins"]} eventId={event.id} />
      <div className="mx-auto max-w-xl px-6 py-10">
        {/* Top nav */}
        <div className="mb-4">
          <Link
            href={`/e/${event.slug}`}
            className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.25em] opacity-80 hover:opacity-100"
          >
            ← Back to event
          </Link>
        </div>
        {/* Ticket stub */}
        <div className="grain border-2 bg-white text-ink" style={{ borderColor: accent }}>
          <div
            className="px-6 py-4 text-center font-display text-xs uppercase tracking-[0.3em]"
            style={{ background: primary, color: onPrimary }}
          >
            {event.id_card_org_name ?? event.name}
          </div>
          <div className="px-8 py-8 text-center">
            <div className="text-[10px] uppercase tracking-[0.3em] text-ink/50">
              Chest number
            </div>
            <div
              className="mt-2 font-display text-8xl font-black leading-none tracking-tight"
              style={{ color: primary }}
            >
              {String(reg.chest_no ?? 0).padStart(3, "0")}
            </div>
            <div className="mt-4 font-display text-2xl font-bold">
              {reg.initial ? `${reg.initial}. ` : ""}
              {reg.full_name}
            </div>
            <div className="mt-1 text-sm text-ink/60">
              {reg.division} · {reg.declared_weight_kg} kg
            </div>
          </div>
          <div className="ticket-edge h-4" />
          <div className="px-8 py-6">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.3em] text-ink/50">
                Status
              </div>
              <div
                className="mt-1 font-display text-lg font-bold"
                style={{ color: primary }}
              >
                {statusLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Payment block */}
        {paymentMode === "offline" && amount > 0 && payment?.status !== "verified" ? (
          <section className="mt-8 border-2 border-white/20 bg-black/20 p-6">
            <h2 className="font-display text-xs uppercase tracking-[0.3em] opacity-80">
              Step 2 · Pay ₹{amount} at the counter
            </h2>
            <div className="mt-3 grid gap-3 text-sm opacity-90">
              <p>
                This event collects fees in person. Hand the amount to your
                <strong> district secretary</strong> in advance, or pay
                cash / UPI at the registration counter on event day.
              </p>
              <p className="text-xs opacity-70">
                Quote chest number{" "}
                <span
                  className="font-mono font-bold"
                  style={{ color: accent }}
                >
                  {String(reg.chest_no ?? 0).padStart(3, "0")}
                </span>{" "}
                so the operator can tick you off.
              </p>
            </div>
          </section>
        ) : !onlinePaymentEnabled && amount === 0 ? (
          <section className="mt-8 border-2 border-white/20 bg-black/20 p-6">
            <h2 className="font-display text-xs uppercase tracking-[0.3em] opacity-80">
              Step 2 · No fee
            </h2>
            <p className="mt-3 text-sm opacity-90">
              No entry fee for this event. Head straight to weigh-in.
            </p>
          </section>
        ) : payment?.status !== "verified" && (
          <section className="mt-8 border-2 border-white/20 bg-black/20 p-6">
            <h2 className="font-display text-xs uppercase tracking-[0.3em] opacity-80">
              Step 2 · Pay ₹{amount} via UPI
              {paymentMode === "hybrid" && (
                <span className="ml-2 text-[10px] opacity-70">
                  · or pay at the counter
                </span>
              )}
            </h2>
            <div className="mt-4 grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="UPI QR"
                className="mx-auto h-48 w-48 bg-white p-2"
              />
              <div className="text-sm">
                <div className="text-xs uppercase tracking-widest opacity-60">
                  UPI ID
                </div>
                <div className="font-mono text-base">{upiId}</div>
                <div className="mt-3 text-xs uppercase tracking-widest opacity-60">
                  Amount
                </div>
                <div className="text-2xl font-bold" style={{ color: accent }}>
                  ₹{amount}
                </div>
                <div className="mt-3 text-xs uppercase tracking-widest opacity-60">
                  Note / reference
                </div>
                <div className="break-all font-mono text-xs">{note}</div>
                <a
                  href={upiUri}
                  className="mt-4 inline-block text-xs underline opacity-80 hover:opacity-100"
                >
                  Open in UPI app →
                </a>
                {paymentMode === "hybrid" && (
                  <p className="mt-3 text-[11px] opacity-70">
                    Prefer cash? Hand it to your district secretary, or pay
                    at the registration counter on event day.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {payment && payment.status !== "verified" && paymentMode !== "offline" && (
          <PaymentProofForm
            registrationId={reg.id}
            eventId={event.id}
            paymentStatus={payment.status}
            proofs={(proofs ?? []).map((p) => ({
              id: p.id as string,
              utr: (p.utr as string) ?? "",
              created_at: p.created_at as string,
            }))}
            isOwner={isOwner}
            accent={accent}
          />
        )}

        {/* Weigh-in + eligibility */}
        <section className="mt-8 border-2 border-white/20 bg-black/20 p-6">
          <h2 className="font-display text-xs uppercase tracking-[0.3em] opacity-80">
            Step 3 · Weigh-in & eligibility
          </h2>
          {!weighIn ? (
            <div className="mt-4 text-sm opacity-80">
              <div className="font-display text-base font-bold" style={{ color: accent }}>
                Awaiting weigh-in
              </div>
              <p className="mt-1 opacity-70">
                Declared weight: <strong>{reg.declared_weight_kg} kg</strong>. Final
                eligibility will appear here once an official records your
                weigh-in at the venue.
              </p>
              {declaredEntries.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                    Categories you registered for
                  </div>
                  <ul className="mt-2 space-y-1 font-mono text-xs">
                    {declaredEntries.map((e) => (
                      <li key={e.category_code}>· {e.category_code}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                    Measured weight
                  </div>
                  <div
                    className="font-display text-3xl font-black"
                    style={{ color: accent }}
                  >
                    {Number(weighIn.measured_kg).toFixed(2)} kg
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                    Weighed at
                  </div>
                  <div className="text-sm">
                    {new Date(weighIn.weighed_at as string).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                  {weigherName && (
                    <div className="mt-1 text-xs opacity-70">
                      by {weigherName}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <div className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                  Eligible categories
                </div>
                {eligibleEntries.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {eligibleEntries.map((e) => (
                      <li
                        key={e.category_code}
                        className="flex items-center gap-2 font-mono text-xs"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: accent }}
                        />
                        <span>{e.category_code}</span>
                        <span className="opacity-60">
                          — {e.division} · {e.age_band} · {e.weight_class} ·{" "}
                          {e.hand}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs opacity-70">
                    No eligible categories at this weight. Talk to the
                    head referee.
                  </p>
                )}
              </div>

              {droppedEntries.length > 0 && (
                <div className="mt-5 border-t border-white/15 pt-4">
                  <div className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                    Missed weight
                  </div>
                  <ul className="mt-2 space-y-1 font-mono text-xs opacity-70">
                    {droppedEntries.map((e) => (
                      <li key={e.category_code}>✗ {e.category_code}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] opacity-60">
                    These categories are no longer available at your
                    measured weight.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {canEdit && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <PendingLink
              href={`/e/${event.slug}/registered/${reg.public_token}/edit`}
              prefetch
              pendingLabel="Loading…"
              className="border-2 px-6 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] hover:bg-white/10"
              style={{ borderColor: accent, color: accent }}
            >
              Edit my registration
            </PendingLink>
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-50">
              Editable until payment is verified
            </p>
          </div>
        )}

        {/* Acknowledgement download — always available; PDF reflects
            current verification state. */}
        <div className="mt-8 flex flex-col items-center gap-2">
          <a
            href={`/api/registered/${reg.public_token}/acknowledgement`}
            className="border-2 px-6 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] hover:bg-white/10"
            style={{ borderColor: accent, color: accent }}
          >
            Download acknowledgement (PDF)
          </a>
          <p className="text-[10px] uppercase tracking-[0.2em] opacity-50">
            {payment?.status === "verified"
              ? "Includes verifier name and timestamp"
              : "Will include verifier details once payment is verified"}
          </p>
        </div>
      </div>
    </main>
  );
}
