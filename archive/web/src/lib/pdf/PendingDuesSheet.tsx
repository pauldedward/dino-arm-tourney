import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

export type DueRow = {
  chest_no: number | null;
  full_name: string | null;
  district: string | null;
  team: string | null;
  amount_inr: number;
  status: string;
};

export function PendingDuesSheet({
  event,
  rows,
}: {
  event: { name: string };
  rows: DueRow[];
}) {
  const total = rows.reduce((n, r) => n + (r.amount_inr ?? 0), 0);
  return (
    <Document>
      <Page size="A4" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Pending dues</Text>
        <Text style={sharedStyles.meta}>{rows.length} pending · ₹{total.toLocaleString()}</Text>
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { width: 26 }]}>#</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Name</Text>
            <Text style={[sharedStyles.th, { width: 100 }]}>District/Team</Text>
            <Text style={[sharedStyles.th, { width: 50 }]}>Amount</Text>
            <Text style={[sharedStyles.th, { width: 60 }]}>Status</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={sharedStyles.tr}>
              <Text style={[sharedStyles.td, { width: 26 }]}>{r.chest_no ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{r.full_name}</Text>
              <Text style={[sharedStyles.td, { width: 100 }]}>{r.district ?? r.team ?? ""}</Text>
              <Text style={[sharedStyles.td, { width: 50 }]}>₹{r.amount_inr}</Text>
              <Text style={[sharedStyles.td, { width: 60 }]}>{r.status}</Text>
            </View>
          ))}
        </View>
        <Text style={sharedStyles.pageFooter} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
