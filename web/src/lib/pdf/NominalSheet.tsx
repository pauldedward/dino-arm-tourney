import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";
import { formatCategoryListForDisplay } from "@/lib/rules/category-label";

export type NominalRow = {
  chest_no: number | null;
  full_name: string | null;
  gender: string | null;
  dob: string | null;
  mobile: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  age_categories: string[] | null;
  /** Resolved weight buckets per entry (already includes " ↑" for
   *  competing-up). Empty when row has no resolvable entry. */
  weight_classes: string[];
  status: string;
  paid: boolean;
  weighed: boolean;
};

export function NominalSheet({
  event,
  rows,
}: {
  event: { name: string };
  rows: NominalRow[];
}) {
  const sorted = [...rows].sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? "")
  );
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Nominal Roll</Text>
        <Text style={sharedStyles.meta}>
          Generated {new Date().toLocaleString("en-IN")} · {rows.length} athletes
          · includes unpaid &amp; un-weighed
        </Text>
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { width: 36 }]}>Chest</Text>
            <Text style={[sharedStyles.th, { flex: 1.4 }]}>Name</Text>
            <Text style={[sharedStyles.th, { width: 36 }]}>Gender</Text>
            <Text style={[sharedStyles.th, { width: 56 }]}>DOB</Text>
            <Text style={[sharedStyles.th, { width: 70 }]}>Mobile</Text>
            <Text style={[sharedStyles.th, { width: 90 }]}>Age Category</Text>
            <Text style={[sharedStyles.th, { width: 100 }]}>Weight Class</Text>
            <Text style={[sharedStyles.th, { width: 36 }]}>Wt</Text>
            <Text style={[sharedStyles.th, { width: 90 }]}>Team / District</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Event</Text>
          </View>
          {sorted.map((r, i) => (
            <View key={i} style={sharedStyles.tr} wrap={false}>
              <Text style={[sharedStyles.td, { width: 36 }]}>{r.chest_no ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1.4 }]}>{r.full_name}</Text>
              <Text style={[sharedStyles.td, { width: 36 }]}>{r.gender ?? ""}</Text>
              <Text style={[sharedStyles.td, { width: 56 }]}>{r.dob ?? ""}</Text>
              <Text style={[sharedStyles.td, { width: 70 }]}>{r.mobile ?? ""}</Text>
              <Text style={[sharedStyles.td, { width: 90 }]}>
                {formatCategoryListForDisplay(r.age_categories ?? [])}
              </Text>
              <Text style={[sharedStyles.td, { width: 100 }]}>
                {(r.weight_classes ?? []).join(", ")}
              </Text>
              <Text style={[sharedStyles.td, { width: 36 }]}>
                {r.declared_weight_kg}
              </Text>
              <Text style={[sharedStyles.td, { width: 90 }]}>
                {[r.team, r.district].filter(Boolean).join(" / ")}
              </Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{event.name}</Text>
            </View>
          ))}
        </View>
        <Text
          style={sharedStyles.pageFooter}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
