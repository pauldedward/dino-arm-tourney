import React from "react";
import { Document, Page, View, Text, sharedStyles, colors } from "@/lib/pdf/base";

export type PaymentReportRow = {
  chest_no: number | null;
  full_name: string | null;
  team_or_district: string | null;
  category: string;
  /** Total fee owed (mutable via adjust-total). */
  total_inr: number;
  /** Sum of active (non-reversed) collections. */
  paid_inr: number;
  /** total_inr - paid_inr, never negative. Zero when fully collected. */
  due_inr: number;
  /** Latest non-reversed `payment_collections.payer_label` (district / team / coach). */
  paid_by: string | null;
};

export type PaymentReportTotals = {
  total_athletes: number;
  total_paid: number;
  total_due: number;
  percent_paid: number;
};

/**
 * Branded "Payment Report" PDF — mirror of the XLSX export. Same totals
 * band, same columns, same GRAND TOTAL row so an event organiser can
 * print or download whichever format the recipient asks for.
 */
export function PaymentReportSheet({
  event,
  rows,
  totals,
}: {
  event: { name: string };
  rows: PaymentReportRow[];
  totals: PaymentReportTotals;
}) {
  return (
    <Document>
      <Page size="A4" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Payment Report</Text>
        <Text style={sharedStyles.meta}>
          Generated {new Date().toLocaleString("en-IN")}
        </Text>

        {/* Summary band */}
        <View
          style={{
            flexDirection: "row",
            borderWidth: 1,
            borderColor: colors.ink,
            marginBottom: 10,
          }}
        >
          {[
            { label: "Athletes", value: totals.total_athletes.toLocaleString("en-IN") },
            { label: "Paid (₹)", value: totals.total_paid.toLocaleString("en-IN") },
            { label: "Due (₹)", value: totals.total_due.toLocaleString("en-IN") },
            { label: "% Paid", value: `${round2(totals.percent_paid)}%` },
          ].map((c, i) => (
            <View
              key={c.label}
              style={{
                flex: 1,
                padding: 6,
                borderRightWidth: i === 3 ? 0 : 1,
                borderColor: colors.ink,
              }}
            >
              <Text style={{ fontSize: 7, color: "#666", textTransform: "uppercase" }}>
                {c.label}
              </Text>
              <Text style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>
                {c.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Table */}
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { width: 40 }]}>Chest</Text>
            <Text style={[sharedStyles.th, { flex: 1.4 }]}>Athlete</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Team / District</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Category</Text>
            <Text style={[sharedStyles.th, { width: 46, textAlign: "right" }]}>Total ₹</Text>
            <Text style={[sharedStyles.th, { width: 46, textAlign: "right" }]}>Paid ₹</Text>
            <Text style={[sharedStyles.th, { width: 46, textAlign: "right" }]}>Due ₹</Text>
            <Text style={[sharedStyles.th, { flex: 0.9 }]}>Paid by</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={sharedStyles.tr}>
              <Text style={[sharedStyles.td, { width: 40 }]}>{r.chest_no ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1.4 }]}>{r.full_name ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{r.team_or_district ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{r.category}</Text>
              <Text style={[sharedStyles.td, { width: 46, textAlign: "right" }]}>
                {r.total_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { width: 46, textAlign: "right" }]}>
                {r.paid_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { width: 46, textAlign: "right" }]}>
                {r.due_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { flex: 0.9 }]}>{r.paid_by ?? ""}</Text>
            </View>
          ))}
          {/* GRAND TOTAL */}
          <View
            style={[
              sharedStyles.tr,
              {
                borderTopWidth: 1,
                borderColor: colors.ink,
                backgroundColor: "#f3f3f3",
                minHeight: 18,
              },
            ]}
          >
            <Text style={[sharedStyles.td, { width: 40, fontWeight: 700 }]}> </Text>
            <Text style={[sharedStyles.td, { flex: 1.4, fontWeight: 700 }]}> </Text>
            <Text style={[sharedStyles.td, { flex: 1, fontWeight: 700 }]}> </Text>
            <Text
              style={[
                sharedStyles.td,
                { flex: 1, fontWeight: 700, textAlign: "right" },
              ]}
            >
              GRAND TOTAL
            </Text>
            <Text style={[sharedStyles.td, { width: 46, fontWeight: 700 }]}> </Text>
            <Text
              style={[
                sharedStyles.td,
                { width: 46, fontWeight: 700, textAlign: "right" },
              ]}
            >
              {totals.total_paid.toLocaleString("en-IN")}
            </Text>
            <Text
              style={[
                sharedStyles.td,
                { width: 46, fontWeight: 700, textAlign: "right" },
              ]}
            >
              {totals.total_due.toLocaleString("en-IN")}
            </Text>
            <Text style={[sharedStyles.td, { flex: 0.9, fontWeight: 700 }]}> </Text>
          </View>
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
