import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

export type IdRow = {
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  photo_url: string | null;
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
};

const CARD_W = 268;
const CARD_H = 168;

export function IdCardSheet({ event, rows }: { event: IdEvent; rows: IdRow[] }) {
  const primary = event.primary_color ?? "#0f3d2e";
  const accent = event.accent_color ?? "#f5c518";
  const onPrimary = event.text_on_primary ?? "#ffffff";

  // 2 columns × 4 rows = 8 per A4.
  const pages: IdRow[][] = [];
  for (let i = 0; i < rows.length; i += 8) pages.push(rows.slice(i, i + 8));
  if (pages.length === 0) pages.push([]);

  return (
    <Document>
      {pages.map((pageRows, pi) => (
        <Page key={pi} size="A4" style={{ padding: 14, flexDirection: "row", flexWrap: "wrap" }}>
          {pageRows.map((r, i) => (
            <View
              key={i}
              style={{
                width: CARD_W,
                height: CARD_H,
                margin: 6,
                backgroundColor: primary,
                color: onPrimary,
                padding: 8,
                borderWidth: 1,
                borderColor: "#000",
              }}
            >
              <Text style={{ fontSize: 6.5, opacity: 0.8 }}>
                {(event.id_card_org_name ?? "ORGANISATION").toUpperCase()}
              </Text>
              <Text style={{ fontSize: 10, fontWeight: 700, marginTop: 1 }}>
                {event.id_card_event_title ?? event.name}
              </Text>
              {event.id_card_subtitle && (
                <Text style={{ fontSize: 6.5, opacity: 0.85 }}>{event.id_card_subtitle}</Text>
              )}
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                <View style={{ width: 78, height: 100, borderWidth: 1, borderColor: accent, backgroundColor: "#fff" }} />
                <View style={{ flex: 1, paddingLeft: 8 }}>
                  <Text style={{ fontSize: 24, fontWeight: 700 }}>#{r.chest_no ?? ""}</Text>
                  <Text style={{ fontSize: 9, fontWeight: 700, marginTop: 2 }}>{(r.full_name ?? "").toUpperCase()}</Text>
                  <Text style={{ fontSize: 7, marginTop: 4 }}>{r.division}</Text>
                  <Text style={{ fontSize: 7 }}>{r.district ?? r.team ?? ""}</Text>
                  <Text style={{ fontSize: 7 }}>Decl: {r.declared_weight_kg} kg</Text>
                </View>
              </View>
              <View style={{ position: "absolute", bottom: 6, left: 8, right: 8, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 5.5, opacity: 0.8 }}>{event.id_card_footer ?? ""}</Text>
                <Text style={{ fontSize: 5.5, opacity: 0.8 }}>
                  {event.id_card_signatory_name ?? ""}
                  {event.id_card_signatory_title ? ` · ${event.id_card_signatory_title}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
