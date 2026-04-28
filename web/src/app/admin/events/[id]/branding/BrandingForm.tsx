"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ID_CARD_GEOMETRY,
  ORG_NAME_DEFAULT_PT,
  TITLE_DEFAULT_PT,
} from "@/lib/pdf/IdCardSheet";
import {
  encodeCode39,
  fitNarrowToWidth,
  quietZone,
  sanitizeCode39,
} from "@/lib/pdf/code39";
import { BRAND_DEFAULT_ORG_LONG_NAME } from "@/lib/brand";

interface EventBrand {
  id: string;
  name: string;
  slug: string;
  // Colours and logo live on the event row but are edited from the
  // Edit Event page (Branding + Files tabs). We still read them so the
  // live preview is accurate, but the form does not let you change them.
  primary_color: string | null;
  accent_color: string | null;
  text_on_primary: string | null;
  logo_url: string | null;
  id_card_org_name: string | null;
  id_card_event_title: string | null;
  id_card_subtitle: string | null;
  id_card_footer: string | null;
  id_card_signatory_name: string | null;
  id_card_signatory_title: string | null;
  id_card_signature_url: string | null;
  id_card_org_name_size: number | null;
  id_card_event_title_size: number | null;
}

export default function BrandingForm({ event }: { event: EventBrand }) {
  const router = useRouter();
  // Org name and event title default to the app/event values so an
  // organiser sees real text on first load instead of an empty input.
  // They remain editable.
  const [form, setForm] = useState({
    id_card_org_name: event.id_card_org_name ?? BRAND_DEFAULT_ORG_LONG_NAME,
    id_card_event_title: event.id_card_event_title ?? event.name,
    id_card_subtitle: event.id_card_subtitle ?? "",
    id_card_footer: event.id_card_footer ?? "",
    id_card_signatory_name: event.id_card_signatory_name ?? "",
    id_card_signatory_title: event.id_card_signatory_title ?? "",
    id_card_org_name_size:
      event.id_card_org_name_size != null
        ? String(event.id_card_org_name_size)
        : "",
    id_card_event_title_size:
      event.id_card_event_title_size != null
        ? String(event.id_card_event_title_size)
        : "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const body = {
      ...form,
      id_card_org_name_size:
        form.id_card_org_name_size === ""
          ? null
          : Number(form.id_card_org_name_size),
      id_card_event_title_size:
        form.id_card_event_title_size === ""
          ? null
          : Number(form.id_card_event_title_size),
    };
    const res = await fetch(`/api/admin/events/${event.id}/branding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg(json.error ?? "save failed");
      return;
    }
    setMsg("Saved.");
    router.refresh();
  }

  // Colours and logo come from the event row so the preview stays
  // truthful even though they are not editable here.
  const previewBrand = {
    primary_color: event.primary_color ?? "#0f3d2e",
    accent_color: event.accent_color ?? "#f5c518",
    text_on_primary: event.text_on_primary ?? "#ffffff",
    logo_url: event.logo_url ?? "",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="border-2 border-ink bg-bone px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] hover:bg-ink hover:text-bone"
        >
          {"\u2190"} Back
        </button>
        <a
          href={`/admin/events/${event.id}/print/id-cards`}
          className="font-mono text-[10px] uppercase tracking-[0.3em] underline"
        >
          Print ID cards {"\u2192"}
        </a>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* Form */}
        <div className="space-y-6 border-2 border-ink p-6">
          <p className="border-l-2 border-ink/30 pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
            Colours, logo and poster are managed on the{" "}
            <a
              href={`/admin/events/${event.id}/edit`}
              className="underline hover:text-ink"
            >
              Edit event
            </a>{" "}
            page (Branding + Files tabs).
          </p>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              ID card content
            </h3>
            <p className="mt-1 font-mono text-[10px] text-ink/50">
              Org name and event title are pre-filled from the event{" "}
              {"\u2014"} change them only if the printed ID should read
              differently.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {(
                [
                  ["id_card_org_name", "Org name", BRAND_DEFAULT_ORG_LONG_NAME],
                  ["id_card_event_title", "Event title", event.name],
                  ["id_card_subtitle", "Subtitle", ""],
                  ["id_card_footer", "Footer line", ""],
                  ["id_card_signatory_name", "Signatory name", ""],
                  ["id_card_signatory_title", "Signatory title", ""],
                ] as const
              ).map(([k, label, placeholder]) => (
                <label key={k} className="col-span-1 block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
                    {label}
                  </span>
                  <input
                    value={form[k]}
                    placeholder={placeholder || undefined}
                    onChange={(e) => set(k, e.target.value)}
                    className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              ID card text sizes (PDF points)
            </h3>
            <p className="mt-1 font-mono text-[10px] text-ink/50">
              Leave blank to use the defaults (org {ORG_NAME_DEFAULT_PT} pt,
              title {TITLE_DEFAULT_PT} pt). Increase if a name is too small,
              decrease if it overflows. Changes appear instantly in the
              preview.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <SizeInput
                label={`Org name size (5\u201314)`}
                value={form.id_card_org_name_size}
                placeholder={String(ORG_NAME_DEFAULT_PT)}
                min={5}
                max={14}
                onChange={(v) => set("id_card_org_name_size", v)}
              />
              <SizeInput
                label={`Event title size (6\u201316)`}
                value={form.id_card_event_title_size}
                placeholder={String(TITLE_DEFAULT_PT)}
                min={6}
                max={16}
                onChange={(v) => set("id_card_event_title_size", v)}
              />
            </div>
          </section>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="border-2 border-ink bg-ink px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-bone disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save branding"}
            </button>
            {msg && <span className="font-mono text-xs text-ink/70">{msg}</span>}
          </div>
        </div>

        {/* Preview */}
        <PreviewPanel
          form={{ ...previewBrand, ...form }}
          fallbackTitle={event.name}
        />
      </div>
    </div>
  );
}

/**
 * Pixel-accurate live preview. We render every section at exactly the
 * proportions used by the PDF (heights and font sizes from
 * ID_CARD_GEOMETRY), so what the organiser sees here is what they get on
 * paper. The whole card is scaled by a single factor so it fits the
 * sidebar.
 */
interface PreviewForm {
  primary_color: string;
  accent_color: string;
  text_on_primary: string;
  logo_url: string;
  id_card_org_name: string;
  id_card_event_title: string;
  id_card_subtitle: string;
  id_card_org_name_size: string;
  id_card_event_title_size: string;
}

function PreviewPanel({
  form,
  fallbackTitle,
}: {
  form: PreviewForm;
  fallbackTitle: string;
}) {
  const G = ID_CARD_GEOMETRY;
  const DISPLAY_W = 280; // CSS px the preview card renders at
  const scale = DISPLAY_W / G.CARD_W;
  const px = (pt: number) => pt * scale;

  const orgPt = form.id_card_org_name_size
    ? Number(form.id_card_org_name_size)
    : ORG_NAME_DEFAULT_PT;
  const titlePt = form.id_card_event_title_size
    ? Number(form.id_card_event_title_size)
    : TITLE_DEFAULT_PT;

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        Live preview
      </p>
      <div
        style={{
          width: DISPLAY_W,
          height: px(G.CARD_H),
          background: form.primary_color,
          color: form.text_on_primary,
          border: "1px solid rgba(0,0,0,0.4)",
        }}
      >
        {/* 1. Banner */}
        <div
          style={{
            height: px(G.BANNER_H),
            paddingLeft: px(4),
            paddingRight: px(4),
            background: form.accent_color,
            color: "#000",
            display: "flex",
            alignItems: "center",
            gap: px(4),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={form.logo_url || "/brand/logo.jpg"}
            alt=""
            style={{
              width: px(G.BANNER_H - 4),
              height: px(G.BANNER_H - 4),
              background: "#fff",
              objectFit: "contain",
              borderRadius: px(2),
            }}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              wordBreak: "break-word",
              hyphens: "none",
            }}
          >
            <span
              style={{
                fontSize: px(orgPt),
                fontWeight: 700,
                letterSpacing: "0.05em",
                lineHeight: 1.2,
                textTransform: "uppercase",
                textAlign: "center",
              }}
            >
              {form.id_card_org_name || BRAND_DEFAULT_ORG_LONG_NAME.toUpperCase()}
            </span>
            {form.id_card_subtitle ? (
              <span
                style={{
                  fontSize: px(Math.max(4.5, orgPt - 1.5)),
                  marginTop: px(1),
                  opacity: 0.85,
                  lineHeight: 1.2,
                  textAlign: "center",
                }}
              >
                {form.id_card_subtitle}
              </span>
            ) : null}
          </div>
        </div>

        {/* 2. Event title */}
        <div
          style={{
            height: px(G.TITLE_H),
            paddingLeft: px(8),
            paddingRight: px(8),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: `${Math.max(1, px(0.75))}px solid ${form.accent_color}`,
          }}
        >
          <span
            style={{
              fontSize: px(titlePt),
              fontWeight: 700,
              lineHeight: 1.2,
              textAlign: "center",
            }}
          >
            {form.id_card_event_title || fallbackTitle}
          </span>
        </div>

        {/* 3. Body: passport photo + chest# + name + district */}
        <div
          style={{
            height: px(G.BODY_H),
            paddingTop: px(2),
            paddingBottom: px(2),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: px(G.PHOTO_W),
              height: px(G.PHOTO_H),
              border: `1px solid ${form.accent_color}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              color: "#999",
              fontFamily: "monospace",
              fontSize: px(7),
            }}
          >
            PHOTO
          </div>
          <div
            style={{
              flex: 1,
              width: "100%",
              paddingTop: px(2),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: px(28), fontWeight: 700, lineHeight: 1 }}>
              0001
            </span>
            <span
              style={{
                fontSize: px(9),
                fontWeight: 700,
                marginTop: px(2),
                textAlign: "center",
              }}
            >
              SAMPLE NAME
            </span>
            <span
              style={{
                fontSize: px(7),
                opacity: 0.85,
                marginTop: px(1),
              }}
            >
              {/* genuine middle dot U+00B7 */}
              District {"\u00B7"} 80kg {"\u00B7"} Senior
            </span>
          </div>
        </div>

        {/* 4. Barcode strip - real Code 39 of "0001" so the operator
            sees exactly what gets printed. */}
        <div
          style={{
            height: px(G.BARCODE_H),
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PreviewBarcode scale={scale} sample="0001" />
        </div>
      </div>
      <p className="font-mono text-[10px] text-ink/50">
        Pixel-accurate to the printed PDF. Code 39 barcode strip on every
        card encodes the chest number for USB scanners.
      </p>
    </div>
  );
}

/**
 * Mini Code 39 renderer for the live preview. Uses the same encoder and
 * sizing rules as the PDF (`IdCardSheet.tsx` -> `code39.ts`) so what the
 * organiser sees here matches the print output to the pixel.
 */
function PreviewBarcode({
  scale,
  sample,
}: {
  scale: number;
  sample: string;
}) {
  const G = ID_CARD_GEOMETRY;
  const RATIO = 2.5;
  const NARROW_MAX = 1.4;
  const NARROW_MIN = 0.45;
  const STRIP_AVAILABLE = G.CARD_W - 8;
  const BAR_HEIGHT = G.BARCODE_H - 8;

  const safe = sanitizeCode39(sample);
  const fitted = fitNarrowToWidth(safe, STRIP_AVAILABLE, RATIO);
  const narrow = Math.max(NARROW_MIN, Math.min(NARROW_MAX, fitted));
  const wide = narrow * RATIO;
  const qz = quietZone(narrow);
  const { bars, totalWidth } = encodeCode39(safe, narrow, wide);
  const wrapperWidth = totalWidth + qz * 2;

  return (
    <div
      style={{
        position: "relative",
        width: wrapperWidth * scale,
        height: BAR_HEIGHT * scale,
        background: "#fff",
      }}
    >
      {bars.map((b, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: (qz + b.x) * scale,
            top: 0,
            width: b.w * scale,
            height: BAR_HEIGHT * scale,
            background: "#000",
          }}
        />
      ))}
    </div>
  );
}

function SizeInput({
  label,
  value,
  placeholder,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
      />
    </label>
  );
}
