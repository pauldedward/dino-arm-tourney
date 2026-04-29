import React from "react";
import { Document, Page, View, Text, sharedStyles, colors } from "@/lib/pdf/base";

export type PaymentReportRow = {
  chest_no: number | null;
  full_name: string | null;
  team_or_district: string | null;
  category: string;
  /** Total fee owed (mutable via adjust-total). */
  total_inr: number;
  /** Sum of active (non-reversed) collections. = received + waived. */
  paid_inr: number;
  /** Subset of paid_inr that is real money (cash / UPI / razorpay). */
  received_inr: number;
  /** Subset of paid_inr that is concession (method='waiver'). */
  waived_inr: number;
  /** total_inr - paid_inr, never negative. Zero when fully collected. */
  due_inr: number;
  /** Latest non-reversed `payment_collections.payer_label` (district / team / coach). */
  paid_by: string | null;
};

export type PaymentReportTotals = {
  total_athletes: number;
  /** Sum of total_inr across non-rejected payments. */
  total_billable: number;
  /** Sum of received_inr (real money). */
  total_received: number;
  /** Sum of waived_inr (concession). */
  total_waived: number;
  /** total_billable - total_waived. The new total after waivers. */
  total_effective: number;
  /** Sum of paid_inr (received + waived). Kept for back-compat. */
  total_paid: number;
  /** Sum of due_inr (outstanding on still-pending payments). */
  total_due: number;
  /** # athletes with any waiver applied. */
  waived_n: number;
  /** received / effective × 100, capped at 100. */
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
            marginBottom: 4,
          }}
        >
          {[
            { label: "Athletes", value: totals.total_athletes.toLocaleString("en-IN") },
            { label: "Billable (₹)", value: totals.total_billable.toLocaleString("en-IN") },
            {
              label: `Waived (₹)${totals.waived_n ? ` · ${totals.waived_n}` : ""}`,
              value: totals.total_waived.toLocaleString("en-IN"),
            },
            { label: "Effective (₹)", value: totals.total_effective.toLocaleString("en-IN") },
            { label: "Received (₹)", value: totals.total_received.toLocaleString("en-IN") },
            { label: "Due (₹)", value: totals.total_due.toLocaleString("en-IN") },
            { label: "% Collected", value: `${round2(totals.percent_paid)}%` },
          ].map((c, i, arr) => (
            <View
              key={c.label}
              style={{
                flex: 1,
                padding: 6,
                borderRightWidth: i === arr.length - 1 ? 0 : 1,
                borderColor: colors.ink,
              }}
            >
              <Text style={{ fontSize: 7, color: "#666", textTransform: "uppercase" }}>
                {c.label}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
                {c.value}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 7, color: "#666", marginBottom: 8 }}>
          Effective = Billable − Waived. % Collected = Received ÷ Effective.
        </Text>

        {/* Table */}
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { width: 36 }]}>Chest</Text>
            <Text style={[sharedStyles.th, { flex: 1.4 }]}>Athlete</Text>
            <Text style={[sharedStyles.th, { flex: 1 }]}>Team / District</Text>
            <Text style={[sharedStyles.th, { flex: 0.9 }]}>Category</Text>
            <Text style={[sharedStyles.th, { width: 42, textAlign: "right" }]}>Total ₹</Text>
            <Text style={[sharedStyles.th, { width: 42, textAlign: "right" }]}>Recv ₹</Text>
            <Text style={[sharedStyles.th, { width: 42, textAlign: "right" }]}>Waiv ₹</Text>
            <Text style={[sharedStyles.th, { width: 42, textAlign: "right" }]}>Due ₹</Text>
            <Text style={[sharedStyles.th, { flex: 0.8 }]}>Paid by</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={sharedStyles.tr}>
              <Text style={[sharedStyles.td, { width: 36 }]}>{r.chest_no ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1.4 }]}>{r.full_name ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 1 }]}>{r.team_or_district ?? ""}</Text>
              <Text style={[sharedStyles.td, { flex: 0.9 }]}>{r.category}</Text>
              <Text style={[sharedStyles.td, { width: 42, textAlign: "right" }]}>
                {r.total_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { width: 42, textAlign: "right" }]}>
                {r.received_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { width: 42, textAlign: "right" }]}>
                {r.waived_inr ? r.waived_inr.toLocaleString("en-IN") : ""}
              </Text>
              <Text style={[sharedStyles.td, { width: 42, textAlign: "right" }]}>
                {r.due_inr.toLocaleString("en-IN")}
              </Text>
              <Text style={[sharedStyles.td, { flex: 0.8 }]}>{r.paid_by ?? ""}</Text>
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
            <Text style={[sharedStyles.td, { width: 36, fontWeight: 700 }]}> </Text>
            <Text style={[sharedStyles.td, { flex: 1.4, fontWeight: 700 }]}> </Text>
            <Text style={[sharedStyles.td, { flex: 1, fontWeight: 700 }]}> </Text>
            <Text
              style={[
                sharedStyles.td,
                { flex: 0.9, fontWeight: 700, textAlign: "right" },
              ]}
            >
              GRAND TOTAL
            </Text>
            <Text style={[sharedStyles.td, { width: 42, fontWeight: 700, textAlign: "right" }]}>
              {totals.total_billable.toLocaleString("en-IN")}
            </Text>
            <Text style={[sharedStyles.td, { width: 42, fontWeight: 700, textAlign: "right" }]}>
              {totals.total_received.toLocaleString("en-IN")}
            </Text>
            <Text style={[sharedStyles.td, { width: 42, fontWeight: 700, textAlign: "right" }]}>
              {totals.total_waived.toLocaleString("en-IN")}
            </Text>
            <Text style={[sharedStyles.td, { width: 42, fontWeight: 700, textAlign: "right" }]}>
              {totals.total_due.toLocaleString("en-IN")}
            </Text>
            <Text style={[sharedStyles.td, { flex: 0.8, fontWeight: 700 }]}> </Text>
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
