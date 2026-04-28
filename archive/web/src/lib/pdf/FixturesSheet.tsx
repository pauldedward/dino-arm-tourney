import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

export type FixtureRow = {
  category_code: string;
  rounds: Array<{
    round_no: number;
    matches: Array<{ match_no: number; a: string | null; b: string | null }>;
  }>;
};

export function FixturesSheet({
  event,
  categories,
}: {
  event: { name: string };
  categories: FixtureRow[];
}) {
  return (
    <Document>
      {categories.map((cat) => (
        <Page key={cat.category_code} size="A4" style={sharedStyles.page}>
          <Text style={sharedStyles.h1}>{event.name}</Text>
          <Text style={sharedStyles.h2}>{cat.category_code}</Text>
          <Text style={sharedStyles.meta}>{cat.rounds.length} rounds</Text>
          <View style={{ flexDirection: "row" }}>
            {cat.rounds.map((r) => (
              <View key={r.round_no} style={{ flex: 1, paddingRight: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 4 }}>R{r.round_no}</Text>
                {r.matches.map((m) => (
                  <View key={m.match_no} style={{ borderWidth: 0.5, borderColor: "#333", padding: 4, marginBottom: 4, minHeight: 40 }}>
                    <Text style={{ fontSize: 6.5, color: "#666" }}>M{m.match_no}</Text>
                    <Text style={{ fontSize: 8 }}>{m.a ?? "—"}</Text>
                    <Text style={{ fontSize: 6.5, color: "#666" }}>vs</Text>
                    <Text style={{ fontSize: 8 }}>{m.b ?? "BYE"}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <Text style={sharedStyles.pageFooter} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  );
}
