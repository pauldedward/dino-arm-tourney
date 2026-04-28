import React from "react";
import { Document, Image, Page, View, Text } from "@/lib/pdf/base";
import { BRAND_DEFAULT_ORG_LONG_NAME } from "@/lib/brand";
import {
  encodeCode39,
  fitNarrowToWidth,
  quietZone,
  sanitizeCode39,
} from "./code39";
import { classLabelsForCard } from "@/lib/rules/class-label";

export type IdRow = {
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  /**
   * Non-para WAF class names the athlete is registered in (the values
   * stored in `registrations.nonpara_classes`, e.g. `"SENIOR"`,
   * `"JUNIOR 18"`). Rendered on the card with the same canonical short
   * label that the category sheet and fixtures use (`"Senior"`, etc.)
   * so a referee never has to translate between two naming schemes.
   */
  nonpara_classes?: readonly (string | null | undefined)[] | null;
  /**
   * Para WAF codes (`registrations.para_codes`, e.g. `"U"`, `"EW"`).
   * Resolved to the same `className` used elsewhere (`"PIU Standing"`).
   */
  para_codes?: readonly (string | null | undefined)[] | null;
  /**
   * Optional override for the scannable strip. When omitted we encode the
   * zero-padded chest number, so any USB barcode reader (Code 39) can punch
   * an athlete in at the table without typing.
   */
  barcode_value?: string | null;
  /**
   * Pre-resolved athlete photo source for react-pdf. Like `event.logo_src`,
   * the route layer turns the registration's `photo_url` (R2 storage key)
   * into a data URI before passing it in - keeps this component pure and
   * avoids react-pdf making private-bucket fetches at render time.
   */
  photo_src?: string | null;
};

export type IdEvent = {
  name: string;
  primary_color?: string | null;
  accent_color?: string | null;
  text_on_primary?: string | null;
  id_card_org_name?: string | null;
  id_card_event_title?: string | null;
  id_card_subtitle?: string | null;
  id_card_footer?: string | null;
  id_card_signatory_name?: string | null;
  id_card_signatory_title?: string | null;
  /**
   * Optional font-size overrides (PDF points). Null/undefined falls back
   * to ORG_NAME_DEFAULT_PT / TITLE_DEFAULT_PT. Organisers can tune these
   * from the branding screen so longer names still fit on the card.
   */
  id_card_org_name_size?: number | null;
  id_card_event_title_size?: number | null;
  /**
   * Pre-resolved logo source for react-pdf. The route layer turns the
   * event's `logo_url` (or the app's default crest) into a URL or data
   * URI before passing it in - keeps this component pure.
   */
  logo_src?: string | null;
};

// Default font sizes for the editable banner and title text. Exported
// so the live preview in BrandingForm can match the PDF exactly.
export const ORG_NAME_DEFAULT_PT = 7.5;
export const TITLE_DEFAULT_PT = 8.5;

// ----- Card geometry ------------------------------------------------------
//
// We use the **CR80 portrait** size (the ISO/IEC 7810 credit-card / lanyard ID
// standard - 54 mm x 85.6 mm). At 72 dpi that's ~153 x 243 pt. Cutting after
// printing yields cards that fit existing badge holders without trimming.
//
// A4 portrait (595 x 842 pt) lays out as a clean 3 x 3 grid:
//   - 17 pt page padding on each side
//   - 17 pt margin around each card (so 34 pt gutter between cards)
//   - Math:  2*17 + 3*(2*17 + 153) = 595         (horizontal, exact)
//            2*14 + 3*(2*14 + 243) = 841 ≈ 842   (vertical, 1 pt slack)
const CARD_W = 153;
const CARD_H = 243;
const PER_PAGE = 9;
const PAGE_PAD_X = 17;
const PAGE_PAD_Y = 14;
const CARD_MARGIN_X = 17;
const CARD_MARGIN_Y = 14;

// Vertical band budget for the CR80 portrait card (243 pt tall):
//   banner 28 + title 14 + body 173 + barcode 28 = 243
// The body holds a centered passport-sized photo (35x45 mm = 99x128 pt)
// and a stacked chest# / name / district block underneath. We dropped the
// signatory/footer band and the in-card division line - operators asked
// for a single big chest number and as much face area as we can spare.
const BANNER_H = 28; // accent strip with logo (left) + org text + subtitle
const TITLE_H = 14; // event title (one line)
const BARCODE_H = 28; // scannable strip (Code 39 bars + quiet zones)
const BODY_H = CARD_H - BANNER_H - TITLE_H - BARCODE_H; // 173

// Code 39 sizing (see ./code39.ts for the full math).
//   - WIDE_NARROW_RATIO 2.5 sits in the middle of the spec-allowed
//     2.0-3.0 band; cheap USB scanners read it reliably.
//   - BARCODE_BAR_HEIGHT must leave 4 pt of vertical padding inside
//     BARCODE_H so the bars never clip the strip's edges.
const WIDE_NARROW_RATIO = 2.5;
const BARCODE_BAR_HEIGHT = BARCODE_H - 8; // 4 pt padding top + bottom
// Horizontal space available for "quiet zone + bars + quiet zone" on the
// card. We keep a 4 pt cosmetic gutter inside the strip so the bars never
// touch the card edge.
const BARCODE_AVAILABLE_W = CARD_W - 8;

// Indian passport photo dimensions: 35 mm x 45 mm (= 99.2 x 127.6 pt at 72
// dpi). We round to whole points to keep the PDF math clean. The photo is
// centered horizontally - card is 153 pt wide, so 27 pt of padding sits on
// either side of the 99 pt passport image.
const PHOTO_W = 99;
const PHOTO_H = 128;
// Reserved height for the chest# + name + district stack under the photo.
// 177 (body) - 128 (photo) - 4 (photo top/bottom padding) = 45.
const INFO_H = BODY_H - PHOTO_H - 4;

// Names that don't fit at this font/width get truncated with an ellipsis so
// the row never wraps and breaks the card layout. ~20 chars at 9 pt bold
// uppercase fits inside the ~145 pt usable card width with a small safety
// margin; we also pass wrap={false} on the Text so any unexpected long
// glyph just clips instead of pushing the district line off the card.
const NAME_MAX_CHARS = 20;

// Re-exported geometry so the BrandingForm live preview can render at the
// exact same proportions as the PDF without duplicating numbers.
export const ID_CARD_GEOMETRY = {
  CARD_W,
  CARD_H,
  BANNER_H,
  TITLE_H,
  BARCODE_H,
  BODY_H,
  PHOTO_W,
  PHOTO_H,
} as const;

function truncateName(name: string, max = NAME_MAX_CHARS): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  // Use a real ellipsis (single glyph) so it counts as one char on screen
  // and in PDF measurement.
  return trimmed.slice(0, max - 1).trimEnd() + "\u2026";
}

/**
 * 9-up A4 portrait ID cards. Every strapline, colour, signatory and logo
 * is per-event - no globals, no hard-coded org. Layout, top to bottom:
 *
 *   1. Banner   - accent colour, logo on the LEFT, org name + subtitle.
 *   2. Title    - event title strip, primary colour.
 *   3. Body     - athlete photo on the left, chest# + name + category +
 *                 district + weight stacked on the right.
 *   4. Barcode  - white "scan zone" with a Code 39 barcode of the chest
 *                 number plus the human-readable value. Designed so a
 *                 USB scanner can be wired into the weigh-in / table app
 *                 later without redesigning the card.
 *   5. Footer   - signatory + footer line, on the primary colour.
 */
export function IdCardSheet({
  event,
  rows,
}: {
  event: IdEvent;
  rows: IdRow[];
}) {
  const primary = event.primary_color ?? "#0F3D2E";
  const accent = event.accent_color ?? "#F5C518";
  const onPrimary = event.text_on_primary ?? "#FFFFFF";
  const onAccent = pickReadableInk(accent);

  const pages: IdRow[][] = [];
  for (let i = 0; i < rows.length; i += PER_PAGE)
    pages.push(rows.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  return (
    <Document>
      {pages.map((pageRows, pi) => (
        <Page
          key={pi}
          size="A4"
          style={{
            paddingHorizontal: PAGE_PAD_X,
            paddingVertical: PAGE_PAD_Y,
            flexDirection: "row",
            flexWrap: "wrap",
          }}
        >
          {pageRows.map((r, i) => (
            <Card
              key={i}
              event={event}
              row={r}
              primary={primary}
              accent={accent}
              onPrimary={onPrimary}
              onAccent={onAccent}
            />
          ))}
        </Page>
      ))}
    </Document>
  );
}

function Card({
  event,
  row,
  primary,
  accent,
  onPrimary,
  onAccent,
}: {
  event: IdEvent;
  row: IdRow;
  primary: string;
  accent: string;
  onPrimary: string;
  onAccent: string;
}) {
  const barcodeValue = (
    row.barcode_value ??
    (row.chest_no != null ? String(row.chest_no).padStart(3, "0") : "")
  ).toUpperCase();

  return (
    <View
      style={{
        width: CARD_W,
        height: CARD_H,
        marginHorizontal: CARD_MARGIN_X,
        marginVertical: CARD_MARGIN_Y,
        backgroundColor: primary,
        color: onPrimary,
        borderWidth: 0.5,
        borderColor: "#000",
      }}
    >
      {/* 1. Banner: logo LEFT, org name + subtitle */}
      <View
        style={{
          height: BANNER_H,
          backgroundColor: accent,
          color: onAccent,
          paddingHorizontal: 4,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {event.logo_src ? (
          <Image
            src={event.logo_src}
            style={{
              width: BANNER_H - 4,
              height: BANNER_H - 4,
              marginRight: 4,
              objectFit: "contain",
              backgroundColor: "#fff",
              borderRadius: 2,
            }}
          />
        ) : (
          <View
            style={{
              width: BANNER_H - 4,
              height: BANNER_H - 4,
              marginRight: 4,
              backgroundColor: "#fff",
              borderRadius: 2,
            }}
          />
        )}
        <View style={{ flex: 1 }}>
          {(() => {
            const orgPt = event.id_card_org_name_size ?? ORG_NAME_DEFAULT_PT;
            // Subtitle is always at least 1.5pt smaller than the org name
            // (with a 4.5pt floor) so the visual hierarchy holds even when
            // the operator bumps the org-name size up or down.
            const subPt = Math.max(4.5, orgPt - 1.5);
            return (
              <>
                <Text
                  style={{
                    fontSize: orgPt,
                    fontWeight: 700,
                    letterSpacing: 0.6,
                    lineHeight: 1.2,
                    textAlign: "center",
                  }}
                >
                  {(event.id_card_org_name ?? BRAND_DEFAULT_ORG_LONG_NAME).toUpperCase()}
                </Text>
                {event.id_card_subtitle ? (
                  <Text
                    style={{
                      fontSize: subPt,
                      marginTop: 1,
                      opacity: 0.85,
                      lineHeight: 1.2,
                      textAlign: "center",
                    }}
                  >
                    {event.id_card_subtitle}
                  </Text>
                ) : null}
              </>
            );
          })()}
        </View>
      </View>

      {/* 2. Event title strip */}
      <View
        style={{
          height: TITLE_H,
          paddingHorizontal: 8,
          justifyContent: "center",
          borderBottomWidth: 0.75,
          borderBottomColor: accent,
        }}
      >
        <Text
          style={{
            fontSize: event.id_card_event_title_size ?? TITLE_DEFAULT_PT,
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          {event.id_card_event_title ?? event.name}
        </Text>
      </View>

      {/* 3. Body: passport photo on top, chest# + name + district stacked below */}
      <View
        style={{
          height: BODY_H,
          paddingTop: 2,
          paddingBottom: 2,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: PHOTO_W,
            height: PHOTO_H,
            borderWidth: 1,
            borderColor: accent,
            backgroundColor: "#fff",
          }}
        >
          {row.photo_src ? (
            <Image
              src={row.photo_src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </View>
        <View
          style={{
            width: "100%",
            height: INFO_H,
            paddingHorizontal: 6,
            paddingTop: 2,
            alignItems: "center",
          }}
        >
          {/* Chest number - the dominant element. Big and centered so gate
              staff can read it across a room. */}
          <Text
            style={{
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1,
              textAlign: "center",
            }}
          >
            {row.chest_no ?? "--"}
          </Text>
          <Text
            wrap={false}
            style={{
              fontSize: 9,
              fontWeight: 700,
              marginTop: 2,
              textAlign: "center",
            }}
          >
            {truncateName((row.full_name ?? "").toUpperCase())}
          </Text>
          {(() => {
            const place = row.district ?? row.team ?? null;
            const wt =
              row.declared_weight_kg != null
                ? `${row.declared_weight_kg}kg`
                : null;
            const cls = classLabelsForCard({
              nonparaClasses: row.nonpara_classes ?? null,
              paraCodes: row.para_codes ?? null,
            });
            const line = [place, wt, cls].filter(Boolean).join(" \u00B7 ");
            if (!line) return null;
            return (
              <Text
                style={{
                  fontSize: 7,
                  opacity: 0.85,
                  textAlign: "center",
                }}
              >
                {line}
              </Text>
            );
          })()}
        </View>
      </View>

      {/* 4. Barcode / scan strip - USB Code 39 scanners read this directly */}
      <BarcodeStrip value={barcodeValue} />
    </View>
  );
}

// ----- Code 39 barcode (USB-scannable) ------------------------------------
//
// The encoder lives in ./code39.ts so it can be unit-tested without
// pulling react-pdf into Node. Here we just decide HOW BIG to draw it.
//
// Sizing strategy ("rigorous fit"):
//   1. Pick the maximum narrow module width that still leaves room for
//      a Code 39 quiet zone (10 * narrow) on each side, inside the
//      strip's available width.
//   2. Cap that narrow at 1.4 pt - any larger and short chest numbers
//      would have huge bars that look ugly. The cap also sets a stable
//      visual rhythm across cards with different chest-number lengths.
//   3. Re-derive quiet zone from the chosen narrow so the bars are
//      exactly centered in the strip.

const BARCODE_NARROW_MAX_PT = 1.4;
const BARCODE_NARROW_MIN_PT = 0.45; // any thinner won't print on home printers

function BarcodeStrip({ value }: { value: string }) {
  // Strip is reserved at constant height even when there's nothing to encode,
  // so cards remain a uniform shape on the print sheet.
  return (
    <View
      style={{
        height: BARCODE_H,
        backgroundColor: "#FFFFFF",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {value ? <Code39 value={value} /> : null}
    </View>
  );
}

function Code39({ value }: { value: string }) {
  const safe = sanitizeCode39(value);
  if (!safe) return null;

  // Step 1: maximum narrow that fits the available card width with quiet
  // zones on both sides.
  const fitted = fitNarrowToWidth(safe, BARCODE_AVAILABLE_W, WIDE_NARROW_RATIO);
  // Step 2: cap to keep the visual rhythm even.
  const narrow = Math.max(
    BARCODE_NARROW_MIN_PT,
    Math.min(BARCODE_NARROW_MAX_PT, fitted),
  );
  const wide = narrow * WIDE_NARROW_RATIO;
  const qz = quietZone(narrow);

  const { bars, totalWidth } = encodeCode39(safe, narrow, wide);
  // outer wrapper width = quiet zone + bars + quiet zone, centered
  const wrapperWidth = totalWidth + qz * 2;

  return (
    <View
      style={{
        width: wrapperWidth,
        height: BARCODE_BAR_HEIGHT,
        backgroundColor: "#FFFFFF",
        position: "relative",
      }}
    >
      {bars.map((b, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: qz + b.x,
            top: 0,
            width: b.w,
            height: BARCODE_BAR_HEIGHT,
            backgroundColor: "#000",
          }}
        />
      ))}
    </View>
  );
}

/**
 * Pick black or white ink for the banner based on the accent's perceived
 * brightness. Keeps the org name legible regardless of the chosen accent.
 */
function pickReadableInk(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 3 && h.length !== 6) return "#0A1B14";
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#0A1B14" : "#FFFFFF";
}
