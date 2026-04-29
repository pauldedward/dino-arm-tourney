"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Org = { id: string; name: string; slug: string };

const STEPS = ["Basics", "Payment", "Files"] as const;
type Step = (typeof STEPS)[number];

type UploadResult = { url: string; kind: "image" | "pdf" };

export default function NewEventForm({ organizations }: { organizations: Org[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("Basics");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueState, setVenueState] = useState("Tamil Nadu");
  const [description, setDescription] = useState("");

  const [paymentMode, setPaymentMode] = useState<"online_upi" | "offline" | "hybrid">("online_upi");
  const [entryFeeInr, setEntryFeeInr] = useState<string>("500");
  const [upiId, setUpiId] = useState("");
  const [upiPayeeName, setUpiPayeeName] = useState("");

  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [circularFile, setCircularFile] = useState<File | null>(null);
  const [circularBusy, setCircularBusy] = useState(false);

  function autoSlug(v: string) {
    setName(v);
    if (!slug) {
      setSlug(
        v
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60)
      );
    }
  }

  async function uploadFile(
    eventId: string,
    file: File,
    purpose: "poster" | "circular"
  ): Promise<UploadResult> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", purpose);
    fd.append("event_id", eventId);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `${purpose} upload failed`);
    if (!json.publicUrl) throw new Error(`${purpose} did not return a public URL`);
    return { url: json.publicUrl, kind: json.kind };
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: orgId,
          name,
          slug,
          starts_at: startsAt,
          ends_at: endsAt || null,
          venue_name: venueName || null,
          venue_city: venueCity || null,
          venue_state: venueState || null,
          description: description || null,
          entry_fee_default_inr: Number(entryFeeInr) || 0,
          upi_id: paymentMode === "offline" ? null : upiId || null,
          upi_payee_name: paymentMode === "offline" ? null : upiPayeeName || null,
          payment_mode: paymentMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed");
      const createdId: string = json.id;
      const createdSlug: string = json.slug ?? slug;

      const patch: Record<string, unknown> = {};
      if (posterFile) {
        setPosterBusy(true);
        try {
          const up = await uploadFile(createdId, posterFile, "poster");
          patch.poster_url = up.url;
          patch.poster_kind = up.kind;
        } finally {
          setPosterBusy(false);
        }
      }
      if (circularFile) {
        setCircularBusy(true);
        try {
          const up = await uploadFile(createdId, circularFile, "circular");
          patch.circular_url = up.url;
        } finally {
          setCircularBusy(false);
        }
      }
      if (Object.keys(patch).length > 0) {
        const pr = await fetch(`/api/admin/events/${createdId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!pr.ok) {
          const pj = await pr.json().catch(() => ({}));
          throw new Error(pj.error ?? "failed to attach files");
        }
      }

      router.push(`/admin/events/${createdSlug}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const idx = STEPS.indexOf(step);
  const canNext = (() => {
    if (step === "Basics")
      return !!orgId && name.length >= 3 && /^[a-z0-9-]{3,60}$/.test(slug) && !!startsAt;
    if (step === "Payment") return Number(entryFeeInr) >= 0;
    return true;
  })();

  return (
    <div className="space-y-6">
      <ol className="flex gap-1 border-2 border-ink bg-bone">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => {
                if (i <= idx) setStep(s);
              }}
              className={`w-full px-2 py-3 font-mono text-[10px] uppercase tracking-[0.2em] ${
                i === idx
                  ? "bg-ink text-bone"
                  : i < idx
                    ? "text-ink hover:bg-kraft/40"
                    : "text-ink/40"
              }`}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="border-2 border-ink p-6">
        {step === "Basics" && (
          <div className="space-y-5">
            <Field label="Organization" required>
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="input"
                required
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Event name" required>
              <input
                value={name}
                onChange={(e) => autoSlug(e.target.value)}
                className="input"
                placeholder="TN State Arm Wrestling Championship 2026"
                required
              />
            </Field>
            <Field label="URL slug" required hint={`Will be public at /e/${slug || "…"}`}>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="input"
                pattern="[a-z0-9-]{3,60}"
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Starts at" required>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="input"
                  required
                />
              </Field>
              <Field label="Ends at">
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Venue name">
              <input
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                className="input"
                placeholder="Jawaharlal Nehru Indoor Stadium"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City">
                <input
                  value={venueCity}
                  onChange={(e) => setVenueCity(e.target.value)}
                  className="input"
                  placeholder="Chennai"
                />
              </Field>
              <Field label="State">
                <input
                  value={venueState}
                  onChange={(e) => setVenueState(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Description" hint="Shown on the public event page">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
                rows={4}
              />
            </Field>
            <p className="font-mono text-xs text-ink/60">
              Branding (colours, ID-card content) and operator invites are
              configured from the event page after creation.
            </p>
          </div>
        )}

        {step === "Payment" && (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em]">
                How will athletes pay?
              </legend>
              <div className="grid gap-2 md:grid-cols-3">
                <ModeCard
                  active={paymentMode === "online_upi"}
                  onClick={() => setPaymentMode("online_upi")}
                  title="Online (UPI)"
                  desc="Athlete scans a QR after registering and uploads UTR + screenshot. Operator verifies."
                />
                <ModeCard
                  active={paymentMode === "offline"}
                  onClick={() => setPaymentMode("offline")}
                  title="Counter only"
                  desc="No QR. Athletes register, then pay cash / UPI at the counter or via their district secretary. Operator ticks them off."
                />
                <ModeCard
                  active={paymentMode === "hybrid"}
                  onClick={() => setPaymentMode("hybrid")}
                  title="Both"
                  desc="QR shown but optional. Operator can also collect at the counter."
                />
              </div>
            </fieldset>

            <Field
              label="Default entry fee per hand (₹)"
              required
              hint="One entry = one hand in one class · use 0 for free events"
            >
              <input
                type="number"
                min={0}
                value={entryFeeInr}
                onChange={(e) => setEntryFeeInr(e.target.value)}
                className="input"
                required
              />
            </Field>
            <p className="font-mono text-xs text-ink/60">
              Fee is per entry (one hand in one class). Concessions for juniors,
              Para, women, or multi-class athletes are reviewed manually — the
              public form shows this default and points athletes to the
              circular or organiser for the exact figure.
            </p>

            {paymentMode !== "offline" ? (
              <>
                <Field label="UPI ID" hint="Athletes scan a QR with this as the payee">
                  <input
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    className="input"
                    placeholder="tnawa@okhdfc"
                  />
                </Field>
                <Field label="UPI payee name">
                  <input
                    value={upiPayeeName}
                    onChange={(e) => setUpiPayeeName(e.target.value)}
                    className="input"
                    placeholder="TNAWA"
                  />
                </Field>
                <p className="font-mono text-xs text-ink/60">
                  The UPI QR shown on each athlete&apos;s payment page is generated
                  automatically from the UPI ID and payee name above — no QR image
                  upload is needed.
                </p>
              </>
            ) : (
              <p className="font-mono text-xs text-ink/60">
                Athletes will see a notice on their registration confirmation
                telling them to pay at the counter on event day, or hand the fee
                to their district secretary in advance. Every registration gets
                a pending payment row in the operator console — group by
                district and tick them off in bulk.
              </p>
            )}
          </div>
        )}

        {step === "Files" && (
          <div className="space-y-6">
            <div>
              <Field
                label="Poster"
                hint="Image (jpg/png) or single-page PDF · shown on the public event page"
              >
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setPosterFile(e.target.files?.[0] ?? null)}
                  className="block w-full font-mono text-xs"
                />
              </Field>
              {posterFile && (
                <p className="mt-1 font-mono text-[11px] text-ink/60">
                  {posterFile.name} · {Math.round(posterFile.size / 1024)} KB
                  {posterBusy && " · uploading…"}
                </p>
              )}
            </div>

            <div>
              <Field
                label="Circular (PDF)"
                hint="Multi-page rulebook / fee schedule athletes can download"
              >
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setCircularFile(e.target.files?.[0] ?? null)}
                  className="block w-full font-mono text-xs"
                />
              </Field>
              {circularFile && (
                <p className="mt-1 font-mono text-[11px] text-ink/60">
                  {circularFile.name} · {Math.round(circularFile.size / 1024)} KB
                  {circularBusy && " · uploading…"}
                </p>
              )}
            </div>

            <p className="font-mono text-xs text-ink/60">
              Both files are optional and can be replaced later from the event
              page. Poster max ≈4 MB (PDF) / ≈500 KB (image after compression);
              circular max 8 MB (PDF).
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <button
            type="button"
            onClick={() => idx > 0 && setStep(STEPS[idx - 1])}
            disabled={idx === 0}
            className="border-2 border-ink px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] disabled:opacity-30"
          >
            ← Back
          </button>
          {idx < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => canNext && setStep(STEPS[idx + 1])}
              disabled={!canNext}
              className="border-2 border-ink bg-ink px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
            >
              Next&nbsp;→
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="border-2 border-rust bg-rust px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create event"}
            </button>
          )}
        </div>
      </div>

      <style jsx global>{`
        .input {
          display: block;
          width: 100%;
          border: 2px solid #0a1b14;
          background: #f6f1e4;
          padding: 0.6rem 0.8rem;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          background: rgba(205, 187, 147, 0.25);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
        <span>
          {label}
          {required && <span className="ml-1 text-rust">*</span>}
        </span>
        {hint && <span className="normal-case tracking-normal text-ink/40">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative h-full border-2 p-4 text-left transition ${
        active
          ? "border-ink bg-ink text-bone"
          : "border-ink/20 bg-bone hover:border-ink"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
          {title}
        </span>
        <span
          className={`inline-block h-3 w-3 rounded-full border-2 ${
            active ? "border-bone bg-rust" : "border-ink/40"
          }`}
        />
      </div>
      <p
        className={`mt-2 font-mono text-[11px] leading-relaxed ${
          active ? "text-bone/80" : "text-ink/60"
        }`}
      >
        {desc}
      </p>
    </button>
  );
}

