import React from "react";
import { Document, Page, View, Text, sharedStyles } from "@/lib/pdf/base";

/**
 * Per-district cash collection sheet. Designed to be printed and handed
 * to the District Convener (DC) so they can collect from each athlete in
 * person and tick them off, then the paper sheet is reconciled at the
 * counter when they hand over the bundle.
 *
 * One Page per district; an "all districts" cover page upfront with totals.
 */

export type CashAthlete = {
  chest_no: number | null;
  full_name: string | null;
  /** Total fee owed. */
  amount_inr: number;
  /** Sum of active (non-reversed) collections; partial when 0 < paid_inr < amount_inr. */
  paid_inr: number;
  /** Derived from payment_summary view (single source of truth). */
  status: "pending" | "verified" | "rejected";
  method: string | null;
};

export type CashDistrict = {
  district: string;
  athletes: CashAthlete[];
};

export function CashCollectionSheet({
  event,
  districts,
}: {
  event: { name: string; starts_at: string | null };
  districts: CashDistrict[];
}) {
  const grand = districts.reduce(
    (acc, d) => {
      const expected = d.athletes.reduce((s, a) => s + (a.amount_inr ?? 0), 0);
      const paid = d.athletes.reduce((s, a) => s + (a.paid_inr ?? 0), 0);
      return {
        athletes: acc.athletes + d.athletes.length,
        expected: acc.expected + expected,
        paid: acc.paid + paid,
      };
    },
    { athletes: 0, expected: 0, paid: 0 }
  );

  return (
    <Document>
      {/* Cover / summary page */}
      <Page size="A4" style={sharedStyles.page}>
        <Text style={sharedStyles.h1}>{event.name} — Cash collection</Text>
        <Text style={sharedStyles.meta}>
          {districts.length} district{districts.length === 1 ? "" : "s"} · {grand.athletes} athletes ·
          Expected ₹{grand.expected.toLocaleString("en-IN")} · Collected ₹
          {grand.paid.toLocaleString("en-IN")} · Outstanding ₹
          {(grand.expected - grand.paid).toLocaleString("en-IN")}
        </Text>
        <View style={sharedStyles.table}>
          <View style={sharedStyles.thead}>
            <Text style={[sharedStyles.th, { flex: 1 }]}>District</Text>
            <Text style={[sharedStyles.th, { width: 50 }]}>Athletes</Text>
            <Text style={[sharedStyles.th, { width: 70 }]}>Expected</Text>
            <Text style={[sharedStyles.th, { width: 70 }]}>Collected</Text>
            <Text style={[sharedStyles.th, { width: 70 }]}>Pending</Text>
          </View>
          {districts.map((d) => {
            const expected = d.athletes.reduce((s, a) => s + (a.amount_inr ?? 0), 0);
            const paid = d.athletes.reduce((s, a) => s + (a.paid_inr ?? 0), 0);
            return (
              <View key={d.district} style={sharedStyles.tr}>
                <Text style={[sharedStyles.td, { flex: 1 }]}>{d.district}</Text>
                <Text style={[sharedStyles.td, { width: 50 }]}>{d.athletes.length}</Text>
                <Text style={[sharedStyles.td, { width: 70 }]}>
                  ₹{expected.toLocaleString("en-IN")}
                </Text>
                <Text style={[sharedStyles.td, { width: 70 }]}>
                  ₹{paid.toLocaleString("en-IN")}
                </Text>
                <Text style={[sharedStyles.td, { width: 70 }]}>
                  ₹{(expected - paid).toLocaleString("en-IN")}
                </Text>
              </View>
            );
          })}
        </View>
      </Page>

      {/* One sheet per district */}
      {districts.map((d) => {
        const expected = d.athletes.reduce((s, a) => s + (a.amount_inr ?? 0), 0);
        const paid = d.athletes.reduce((s, a) => s + (a.paid_inr ?? 0), 0);
        return (
          <Page key={d.district} size="A4" style={sharedStyles.page}>
            <Text style={sharedStyles.h1}>{d.district}</Text>
            <Text style={sharedStyles.meta}>
              {event.name} · {d.athletes.length} athletes · Expected ₹
              {expected.toLocaleString("en-IN")} · Already collected ₹
              {paid.toLocaleString("en-IN")} · Owed ₹
              {(expected - paid).toLocaleString("en-IN")}
            </Text>
            <View style={sharedStyles.table}>
              <View style={sharedStyles.thead}>
                <Text style={[sharedStyles.th, { width: 26 }]}>#</Text>
                <Text style={[sharedStyles.th, { flex: 1 }]}>Athlete</Text>
                <Text style={[sharedStyles.th, { width: 60 }]}>Fee</Text>
                <Text style={[sharedStyles.th, { width: 60 }]}>Paid?</Text>
                <Text style={[sharedStyles.th, { width: 110 }]}>Signature</Text>
              </View>
              {d.athletes.map((a, i) => (
                <View key={i} style={sharedStyles.tr}>
                  <Text style={[sharedStyles.td, { width: 26 }]}>
                    {a.chest_no ?? ""}
                  </Text>
                  <Text style={[sharedStyles.td, { flex: 1 }]}>
                    {a.full_name ?? ""}
                  </Text>
                  <Text style={[sharedStyles.td, { width: 60 }]}>
                    ₹{(a.amount_inr ?? 0).toLocaleString("en-IN")}
                  </Text>
                  <Text style={[sharedStyles.td, { width: 60 }]}>
                    {a.status === "verified"
                      ? `Yes · ${a.method === "cash" ? "Cash" : a.method === "manual_upi" ? "UPI" : a.method ?? ""}`
                      : a.paid_inr > 0
                      ? `Partial ₹${a.paid_inr.toLocaleString("en-IN")}`
                      : "[ ]"}
                  </Text>
                  <Text style={[sharedStyles.td, { width: 110 }]}> </Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 24 }}>
              <Text style={sharedStyles.meta}>
                District Convener name: ___________________________________
              </Text>
              <Text style={[sharedStyles.meta, { marginTop: 12 }]}>
                Total handed over: ₹ ___________________________________
              </Text>
              <Text style={[sharedStyles.meta, { marginTop: 12 }]}>
                Signature & date: ___________________________________
              </Text>
            </View>
            <Text
              style={sharedStyles.pageFooter}
              render={({ pageNumber, totalPages }) =>
                `${d.district} · ${pageNumber} / ${totalPages}`
              }
              fixed
            />
          </Page>
        );
      })}
    </Document>
  );
}
