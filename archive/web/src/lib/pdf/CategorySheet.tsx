import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

export type CategoryRow = {
  category_code: string;
  athletes: Array<{ chest_no: number | null; full_name: string | null; district: string | null }>;
};

export function CategorySheet({
  event,
  categories,
}: {
  event: { name: string };
  categories: CategoryRow[];
}) {
  return (
    <Document>
      <Page size="A4" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Category Sheet</Text>
        <Text style={sharedStyles.meta}>
          {categories.length} categories · {categories.reduce((n, c) => n + c.athletes.length, 0)} entries
        </Text>
        {categories.map((c) => (
          <View key={c.category_code} wrap={false} style={{ marginBottom: 10 }}>
            <Text style={sharedStyles.h2}>{c.category_code} — {c.athletes.length} athletes</Text>
            <View style={sharedStyles.table}>
              <View style={sharedStyles.thead}>
                <Text style={[sharedStyles.th, { width: 26 }]}>#</Text>
                <Text style={[sharedStyles.th, { flex: 1 }]}>Name</Text>
                <Text style={[sharedStyles.th, { width: 100 }]}>District</Text>
              </View>
              {c.athletes.map((a, i) => (
                <View key={i} style={sharedStyles.tr}>
                  <Text style={[sharedStyles.td, { width: 26 }]}>{a.chest_no ?? ""}</Text>
                  <Text style={[sharedStyles.td, { flex: 1 }]}>{a.full_name}</Text>
                  <Text style={[sharedStyles.td, { width: 100 }]}>{a.district ?? ""}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
        <Text style={sharedStyles.pageFooter} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
