"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EventRow, OperatorRow } from "./page";
import { useConfirm } from "@/components/ConfirmDialog";
import { BRAND_DEFAULT_LOGO_SRC } from "@/lib/brand";

const SECTIONS = [
  "Basics",
  "Payment",
  "Files",
  "Branding",
  "Operators",
] as const;
type Section = (typeof SECTIONS)[number];

export default function EditEventForm({
  event,
  operators,
}: {
  event: EventRow;
  operators: OperatorRow[];
}) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [section, setSection] = useState<Section>("Basics");

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav className="space-y-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`block w-full border-2 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.2em] ${
              section === s
                ? "border-ink bg-ink text-bone"
                : "border-ink/20 text-ink/70 hover:border-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </nav>

      <div className="border-2 border-ink p-6">
        {section === "Basics" && <BasicsSection event={event} onSaved={() => router.refresh()} />}
        {section === "Payment" && <PaymentSection event={event} onSaved={() => router.refresh()} />}
        {section === "Files" && <FilesSection event={event} onSaved={() => router.refresh()} />}
        {section === "Branding" && <BrandingSection event={event} onSaved={() => router.refresh()} />}
        {section === "Operators" && <OperatorsSection operators={operators} onChanged={() => router.refresh()} />}
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function patchEvent(eventId: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/admin/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "save failed");
  return json;
}

async function uploadFile(
  eventId: string,
  file: File,
  purpose: "poster" | "circular" | "logo" | "banner" | "signature"
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("purpose", purpose);
  fd.append("event_id", eventId);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  // Vercel's platform 413 ("Request Entity Too Large") is plain text, not JSON,
  // so don't blindly call res.json(). Read text first and parse defensively.
  const raw = await res.text();
  if (res.status === 413) {
    throw new Error(
      `${purpose} file is too large for the upload endpoint (max ~4.5 MB). Compress the image or PDF and try again.`
    );
  }
  let json: { error?: string; kind?: "image" | "pdf"; publicUrl?: string } = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `${purpose} upload failed (HTTP ${res.status}): ${raw.slice(0, 200) || "no response body"}`
    );
  }
  if (!res.ok) throw new Error(json.error ?? `${purpose} upload failed`);
  return json as { kind: "image" | "pdf"; publicUrl: string };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Basics ────────────────────────────────────────────────────────────────

function BasicsSection({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [name, setName] = useState(event.name);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.ends_at));
  const [venueName, setVenueName] = useState(event.venue_name ?? "");
  const [venueCity, setVenueCity] = useState(event.venue_city ?? "");
  const [venueState, setVenueState] = useState(event.venue_state ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  // Format is locked to double_elim today. Other formats are present in the
  // schema for forward-compat (and visible in the UI as "coming soon" cards
  // so organizers can see the roadmap), but selecting them is disabled.
  const [bracketFormat] = useState<"double_elim" | "single_elim" | "round_robin">(
    (event.bracket_format as "double_elim" | "single_elim" | "round_robin" | null) ??
      "double_elim"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patchEvent(event.id, {
        name,
        starts_at: startsAt,
        ends_at: endsAt || null,
        venue_name: venueName || null,
        venue_city: venueCity || null,
        venue_state: venueState || null,
        description: description || null,
        bracket_format: bracketFormat,
      });
      setSavedAt(Date.now());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Event name" required>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Starts at" required>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input" required />
        </Field>
        <Field label="Ends at">
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Venue name">
        <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="City">
          <input value={venueCity} onChange={(e) => setVenueCity(e.target.value)} className="input" />
        </Field>
        <Field label="State">
          <input value={venueState} onChange={(e) => setVenueState(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input" rows={4} />
      </Field>
      <fieldset>
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em]">
          Bracket format
        </legend>
        <div className="grid gap-2 md:grid-cols-3">
          <ModeCard
            active={bracketFormat === "double_elim"}
            onClick={() => {}}
            title="Double elimination"
            desc="WAF / PAFI standard. Athletes get a second chance through the losers' bracket. Currently the only supported format."
          />
          <ModeCard
            active={false}
            onClick={() => {}}
            disabled
            title="Single elimination"
            desc="One loss = out. Coming soon."
          />
          <ModeCard
            active={false}
            onClick={() => {}}
            disabled
            title="Round robin"
            desc="Everyone plays everyone — for tiny categories. Coming soon."
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-ink/50">
          Changing format requires regenerating fixtures from the event dashboard.
        </p>
      </fieldset>
      <SaveBar busy={busy} error={error} savedAt={savedAt} onSave={save} />
      <FormStyles />
    </div>
  );
}

// ─── Payment ───────────────────────────────────────────────────────────────

function PaymentSection({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [mode, setMode] = useState<"online_upi" | "offline" | "hybrid">(
    (event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ?? "online_upi"
  );
  const [fee, setFee] = useState(String(event.entry_fee_default_inr ?? 500));
  // Optional override charged when the operator collects offline (cash /
  // counter-desk UPI). Empty string = no override (use the online fee).
  const [offlineFee, setOfflineFee] = useState(
    event.entry_fee_offline_inr == null ? "" : String(event.entry_fee_offline_inr)
  );
  // Optional Para-only override. Para fees are nearly always lower than
  // the standard offline fee. Empty string = no override (fall through
  // to offline, then default).
  const [paraFee, setParaFee] = useState(
    event.entry_fee_para_inr == null ? "" : String(event.entry_fee_para_inr)
  );
  const [upiId, setUpiId] = useState(event.upi_id ?? "");
  const [upiPayee, setUpiPayee] = useState(event.upi_payee_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patchEvent(event.id, {
        payment_mode: mode,
        entry_fee_default_inr: Number(fee) || 0,
        entry_fee_offline_inr:
          offlineFee.trim() === "" ? null : Number(offlineFee) || 0,
        entry_fee_para_inr:
          paraFee.trim() === "" ? null : Number(paraFee) || 0,
        upi_id: mode === "offline" ? null : upiId || null,
        upi_payee_name: mode === "offline" ? null : upiPayee || null,
      });
      setSavedAt(Date.now());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em]">
          How will athletes pay?
        </legend>
        <div className="grid gap-2 md:grid-cols-3">
          <ModeCard
            active={mode === "online_upi"}
            onClick={() => setMode("online_upi")}
            title="Online (UPI)"
            desc="QR + UTR + screenshot. Operator verifies."
          />
          <ModeCard
            active={mode === "offline"}
            onClick={() => setMode("offline")}
            title="Counter only"
            desc="No QR. Cash / UPI at counter or via district secretary; operator ticks them off."
          />
          <ModeCard
            active={mode === "hybrid"}
            onClick={() => setMode("hybrid")}
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
        <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className="input" />
      </Field>
      {mode !== "online_upi" && (
        <Field
          label="Offline entry fee per hand (₹)"
          hint="Charged when an operator collects cash / desk-UPI. Leave blank to use the same fee as online."
        >
          <input
            type="number"
            min={0}
            value={offlineFee}
            onChange={(e) => setOfflineFee(e.target.value)}
            className="input"
            placeholder={`Same as online (₹${Number(fee) || 0})`}
          />
        </Field>
      )}
      {mode !== "online_upi" && (
        <Field
          label="Para entry fee per hand (₹)"
          hint="Charged for Para entries at the counter desk. Leave blank to use the offline fee (then the online fee)."
        >
          <input
            type="number"
            min={0}
            value={paraFee}
            onChange={(e) => setParaFee(e.target.value)}
            className="input"
            placeholder={`Same as offline (₹${
              offlineFee.trim() === "" ? Number(fee) || 0 : Number(offlineFee) || 0
            })`}
          />
        </Field>
      )}
      <p className="font-mono text-xs text-ink/60">
        Concessions for juniors / Para / women / multi-class athletes are
        reviewed manually. The athlete sees this default and is told to refer
        to the circular or contact the organiser for the exact amount.
      </p>
      {mode !== "offline" ? (
        <>
          <Field label="UPI ID" hint="Used to auto-generate the payment QR">
            <input value={upiId} onChange={(e) => setUpiId(e.target.value)} className="input" placeholder="tnawa@okhdfc" />
          </Field>
          <Field label="UPI payee name">
            <input value={upiPayee} onChange={(e) => setUpiPayee(e.target.value)} className="input" placeholder="TNAWA" />
          </Field>
          <p className="font-mono text-xs text-ink/60">
            The UPI QR is generated on the fly from these two fields — there is no
            QR image to upload.
          </p>
        </>
      ) : (
        <p className="font-mono text-xs text-ink/60">
          Athletes will see a &ldquo;pay at counter&rdquo; notice on their
          confirmation page. Every registration still gets a pending payment
          row — group by district in the operator console and tick them off
          in bulk when the district secretary hands the cash bundle over.
        </p>
      )}
      <SaveBar busy={busy} error={error} savedAt={savedAt} onSave={save} />
      <FormStyles />
    </div>
  );
}

// ─── Files ─────────────────────────────────────────────────────────────────

function FilesSection({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  return (
    <div className="space-y-8">
      <FileSlot
        label="Logo"
        accept="image/*"
        currentUrl={event.logo_url}
        currentKind="image"
        fallbackImageSrc={BRAND_DEFAULT_LOGO_SRC}
        fallbackHint="Using app default crest. Upload to override on this event's PDFs and public page."
        onUpload={async (file) => {
          const up = await uploadFile(event.id, file, "logo");
          await patchEvent(event.id, { logo_url: up.publicUrl });
          onSaved();
        }}
        onRemove={async () => {
          await patchEvent(event.id, { logo_url: null });
          onSaved();
        }}
      />
      <FileSlot
        label="Poster"
        accept="image/*,application/pdf"
        currentUrl={event.poster_url}
        currentKind={event.poster_kind ?? "image"}
        onUpload={async (file) => {
          const up = await uploadFile(event.id, file, "poster");
          await patchEvent(event.id, {
            poster_url: up.publicUrl,
            poster_kind: up.kind,
          });
          onSaved();
        }}
        onRemove={async () => {
          await patchEvent(event.id, { poster_url: null, poster_kind: null });
          onSaved();
        }}
      />
      <FileSlot
        label="Circular (PDF)"
        accept="application/pdf"
        currentUrl={event.circular_url}
        currentKind="pdf"
        onUpload={async (file) => {
          const up = await uploadFile(event.id, file, "circular");
          await patchEvent(event.id, { circular_url: up.publicUrl });
          onSaved();
        }}
        onRemove={async () => {
          await patchEvent(event.id, { circular_url: null });
          onSaved();
        }}
      />
      <FormStyles />
    </div>
  );
}

function FileSlot({
  label,
  accept,
  currentUrl,
  currentKind,
  fallbackImageSrc,
  fallbackHint,
  onUpload,
  onRemove,
}: {
  label: string;
  accept: string;
  currentUrl: string | null;
  currentKind: "image" | "pdf";
  /** Preview to show when nothing has been uploaded yet (e.g. the app's
   *  default crest, which the PDF / public page will use as a fallback). */
  fallbackImageSrc?: string;
  fallbackHint?: string;
  onUpload: (f: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askConfirm = useConfirm();
  const confirm = useConfirm();

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!(await askConfirm({ message: `Remove the current ${label.toLowerCase()}?`, confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em]">{label}</p>
      {currentUrl ? (
        <div className="flex items-center gap-3 border-2 border-ink/20 p-3">
          {currentKind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt=""
              className="h-12 w-12 border border-ink/20 bg-white object-contain p-1"
            />
          ) : null}
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener"
            className="flex-1 font-mono text-xs text-ink/70 underline"
          >
            Current {currentKind} ↗
          </a>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="border border-rust px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ) : fallbackImageSrc ? (
        <div className="flex items-center gap-3 border-2 border-dashed border-ink/20 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fallbackImageSrc}
            alt="app default"
            className="h-12 w-12 border border-ink/20 bg-white object-contain p-1"
          />
          <p className="flex-1 font-mono text-[11px] text-ink/50">
            {fallbackHint ?? "Using app default. Upload to override."}
          </p>
        </div>
      ) : (
        <p className="font-mono text-[11px] text-ink/40">None uploaded.</p>
      )}
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept={accept}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || busy}
          className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
        >
          {busy ? "Uploading…" : currentUrl ? "Replace" : "Upload"}
        </button>
      </div>
      {error && (
        <p className="font-mono text-[11px] text-rust">{error}</p>
      )}
    </div>
  );
}

// ─── Branding ──────────────────────────────────────────────────────────────

function BrandingSection({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [primary, setPrimary] = useState(event.primary_color ?? "#0f3d2e");
  const [accent, setAccent] = useState(event.accent_color ?? "#f5c518");
  const [textOn, setTextOn] = useState(event.text_on_primary ?? "#ffffff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patchEvent(event.id, {
        primary_color: primary,
        accent_color: accent,
        text_on_primary: textOn,
      });
      setSavedAt(Date.now());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="border-l-2 border-ink/30 pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
        ID-card text and signatory live on the dedicated{" "}
        <a
          href={`/admin/events/${event.id}/branding`}
          className="underline hover:text-ink"
        >
          ID card branding
        </a>{" "}
        page.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Primary">
          <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-12 w-full border-2 border-ink" />
        </Field>
        <Field label="Accent">
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-12 w-full border-2 border-ink" />
        </Field>
        <Field label="Text on primary">
          <input type="color" value={textOn} onChange={(e) => setTextOn(e.target.value)} className="h-12 w-full border-2 border-ink" />
        </Field>
      </div>
      <div
        className="mt-2 grid place-items-center border-2 border-ink p-4"
        style={{ background: primary, color: textOn }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-70">
          Theme preview
        </p>
        <p className="mt-2 font-display text-2xl font-black">{event.name}</p>
        <p className="mt-1 font-display text-sm italic" style={{ color: accent }}>
          accent text
        </p>
      </div>
      <SaveBar busy={busy} error={error} savedAt={savedAt} onSave={save} />
      <FormStyles />
    </div>
  );
}

// ─── Operators ─────────────────────────────────────────────────────────────

function OperatorsSection({
  operators,
  onChanged,
}: {
  operators: OperatorRow[];
  onChanged: () => void;
}) {
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ok: number; fail: number } | null>(null);

  async function inviteAll() {
    const list = emails
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    setDone(null);
    let ok = 0;
    let fail = 0;
    for (const email of list) {
      try {
        const res = await fetch("/api/admin/users/invite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, role: "operator" }),
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setDone({ ok, fail });
    setEmails("");
    setBusy(false);
    onChanged();
  }

  return (
    <div className="space-y-6">
      <div>
        <Field
          label="Invite operators"
          hint="One email per line. They get the operator role via Supabase Auth invite."
        >
          <textarea
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            className="input"
            rows={4}
            placeholder={"ops1@tnawa.in\nops2@tnawa.in"}
          />
        </Field>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={inviteAll}
            disabled={busy || !emails.trim()}
            className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
          >
            {busy ? "Inviting…" : "Send invites"}
          </button>
          {done && (
            <p className="font-mono text-[11px] text-ink/60">
              {done.ok} invited{done.fail ? ` · ${done.fail} failed` : ""}
            </p>
          )}
          {error && <p className="font-mono text-[11px] text-rust">{error}</p>}
        </div>
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
          Existing operators
        </p>
        <div className="mt-2 border-2 border-ink/20">
          {operators.length === 0 ? (
            <p className="px-3 py-4 text-center font-mono text-[11px] text-ink/40">
              None yet. Invite some above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 bg-kraft/20 text-left font-mono text-[10px] uppercase tracking-[0.2em]">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Invited</th>
                  <th className="px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((o) => (
                  <tr key={o.id} className="border-b border-ink/5 last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{o.email ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink/70">{o.full_name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink/50">
                      {o.invited_at ? new Date(o.invited_at).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink/50">
                      {o.last_seen_at ? new Date(o.last_seen_at).toLocaleDateString("en-IN") : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] text-ink/40">
          Operator listing is currently global (per-event scoping lands later).
          Manage roles from /admin/users.
        </p>
      </div>
      <FormStyles />
    </div>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function SaveBar({
  busy,
  error,
  savedAt,
  onSave,
}: {
  busy: boolean;
  error: string | null;
  savedAt: number | null;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      {error && (
        <p className="font-mono text-[11px] text-rust">{error}</p>
      )}
      {!error && savedAt && (
        <p className="font-mono text-[11px] text-moss">Saved.</p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="border-2 border-rust bg-rust px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
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

function FormStyles() {
  return (
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
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={`group relative h-full border-2 p-4 text-left transition ${
        active
          ? "border-ink bg-ink text-bone"
          : disabled
            ? "cursor-not-allowed border-dashed border-ink/20 bg-bone/40 opacity-60"
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
