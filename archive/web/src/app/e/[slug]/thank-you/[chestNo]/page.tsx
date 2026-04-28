import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import PaymentProofForm from "./PaymentProofForm";

export const dynamic = "force-dynamic";

export default async function ThankYouPage({
  params,
}: {
  params: Promise<{ slug: string; chestNo: string }>;
}) {
  const { slug, chestNo } = await params;
  const chest = Number(chestNo);
  if (!Number.isInteger(chest)) notFound();

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select(
      "id, slug, name, upi_id, upi_payee_name, entry_fee_default_inr, primary_color, accent_color, text_on_primary"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const { data: reg } = await admin
    .from("registrations")
    .select("id, chest_no, full_name, division, status")
    .eq("event_id", event.id)
    .eq("chest_no", chest)
    .maybeSingle();
  if (!reg) notFound();

  const { data: payment } = await admin
    .from("payments")
    .select("id, amount_inr, status, utr")
    .eq("registration_id", reg.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build UPI deep-link + QR (only if UPI configured).
  let upiUri: string | null = null;
  let qrSvg: string | null = null;
  if (event.upi_id && payment) {
    const params = new URLSearchParams({
      pa: event.upi_id,
      pn: event.upi_payee_name ?? event.name,
      am: String(payment.amount_inr),
      cu: "INR",
      tn: `${event.slug}-${reg.chest_no}`,
    });
    upiUri = `upi://pay?${params.toString()}`;
    qrSvg = await QRCode.toString(upiUri, { type: "svg", margin: 1, width: 240 });
  }

  return (
    <main
      className="min-h-screen bg-bone"
      style={{
        ["--event-primary" as string]: event.primary_color ?? "#0f3d2e",
        ["--event-accent" as string]: event.accent_color ?? "#f5c518",
        ["--event-on-primary" as string]: event.text_on_primary ?? "#ffffff",
      }}
    >
      <header
        className="border-b-2 border-ink"
        style={{ backgroundColor: "var(--event-primary)", color: "var(--event-on-primary)" }}
      >
        <div className="mx-auto max-w-[760px] px-6 py-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-80">
            {event.name}
          </p>
          <h1 className="mt-2 font-display text-[clamp(36px,6vw,72px)] leading-[0.9] tracking-tight2">
            Registered ✓
          </h1>
          <p className="mt-3 font-mono text-sm">
            Chest no <span className="tnum text-2xl">{reg.chest_no}</span> ·{" "}
            {reg.full_name} · {reg.division}
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-[760px] px-6 py-8">
        <div className="border-2 border-ink p-6">
          <h2 className="font-display text-3xl tracking-tight2">Step 2 — Pay entry fee</h2>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-ink/60">
            Entry fee · ₹{payment?.amount_inr ?? event.entry_fee_default_inr ?? 0}
          </p>

          {payment?.status === "verified" ? (
            <div className="mt-6 border-2 border-ink bg-volt p-4 font-mono text-sm">
              Payment already verified. See you at weigh-in.
            </div>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
                <div>
                  {qrSvg ? (
                    <div
                      className="border-2 border-ink bg-bone p-2"
                      // QR code SVG is generated locally from server-controlled
                      // UPI fields. Safe to render as-is.
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                  ) : (
                    <div className="border-2 border-ink bg-bone p-6 font-mono text-xs">
                      QR unavailable — UPI not configured for this event.
                    </div>
                  )}
                </div>
                <div className="space-y-3 font-mono text-sm">
                  <Row k="UPI ID" v={event.upi_id ?? "—"} mono />
                  <Row k="Payee" v={event.upi_payee_name ?? event.name} />
                  <Row k="Amount" v={`₹${payment?.amount_inr ?? 0}`} />
                  <Row
                    k="Reference"
                    v={`${event.slug}-${reg.chest_no}`}
                    mono
                  />
                  {upiUri && (
                    <a
                      href={upiUri}
                      className="mt-2 inline-block border-2 border-ink bg-ink px-4 py-2 text-xs font-bold uppercase tracking-[0.3em] text-bone"
                    >
                      Open UPI app
                    </a>
                  )}
                </div>
              </div>

              {payment && (
                <div className="mt-8 border-t-2 border-ink pt-6">
                  <h3 className="font-display text-xl tracking-tight2">
                    After paying, submit your proof
                  </h3>
                  <PaymentProofForm
                    paymentId={payment.id}
                    initialUtr={payment.utr ?? ""}
                    initialStatus={payment.status as "pending" | "submitted" | "verified" | "rejected"}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
          Save this page — bookmark or screenshot. Bring chest no <span className="tnum">{reg.chest_no}</span> to weigh-in.
        </p>
      </section>
    </main>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/10 pb-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">{k}</span>
      <span className={mono ? "tnum" : ""}>{v}</span>
    </div>
  );
}
