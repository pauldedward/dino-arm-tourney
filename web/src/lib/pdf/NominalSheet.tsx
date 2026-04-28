import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

export type NominalRow = {
  chest_no: number | null;
  full_name: string | null;
  division: string | null;
  district: string | null;
  team: string | null;
  declared_weight_kg: number | null;
  age_categories: string[] | null;
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
      <Page size="A4" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Nominal Roll</Text>
        <Text style={sharedStyles.meta}>
          Generated {new Date().toLocaleString("en-IN")} · {rows.length} athletes
          · includes unpaid &amp; un-weighed
        </Text>
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { width: 26 }]}>#</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Name</Text>
            <Text style={[sharedStyles.th, { width: 70 }]}>Division</Text>
            <Text style={[sharedStyles.th, { width: 80 }]}>District/Team</Text>
            <Text style={[sharedStyles.th, { width: 36 }]}>Wt</Text>
            <Text style={[sharedStyles.th, { width: 80 }]}>Age cats</Text>
            <Text style={[sharedStyles.th, { width: 32 }]}>Pay</Text>
            <Text style={[sharedStyles.th, { width: 36 }]}>Weigh</Text>
          </View>
          {sorted.map((r, i) => (
            <View key={i} style={sharedStyles.tr} wrap={false}>
              <Text style={[sharedStyles.td, { width: 26 }]}>{r.chest_no ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{r.full_name}</Text>
              <Text style={[sharedStyles.td, { width: 70 }]}>{r.division}</Text>
              <Text style={[sharedStyles.td, { width: 80 }]}>
                {r.district ?? r.team ?? ""}
              </Text>
              <Text style={[sharedStyles.td, { width: 36 }]}>
                {r.declared_weight_kg}
              </Text>
              <Text style={[sharedStyles.td, { width: 80 }]}>
                {(r.age_categories ?? []).join(", ")}
              </Text>
              <Text style={[sharedStyles.td, { width: 32 }]}>
                {r.paid ? "✓" : "—"}
              </Text>
              <Text style={[sharedStyles.td, { width: 36 }]}>
                {r.weighed ? "✓" : "—"}
              </Text>
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
