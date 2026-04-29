import React from "react";
import { NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createServiceClient } from "@/lib/db/supabase-service";
import { Document, Page, View, Text, colors } from "@/lib/pdf/base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/registered/[token]/acknowledgement
 *
 * Public download (token-gated): renders a one-page PDF acknowledgement
 * with the athlete's chest number, name, division/weight, payment
 * status and — when verified — who verified it. Useful as a printable
 * receipt the athlete can keep on their phone or hand at the gate.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const svc = createServiceClient();

  const { data: reg } = await svc
    .from("registrations")
    .select(
      "id, chest_no, full_name, initial, division, declared_weight_kg, district, team, status, event_id, created_at"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!reg) return new Response("not found", { status: 404 });

  const { data: event } = await svc
    .from("events")
    .select(
      "id, name, starts_at, primary_color, accent_color, text_on_primary, id_card_org_name, id_card_event_title, id_card_footer, payment_mode"
    )
    .eq("id", reg.event_id)
    .maybeSingle();
  if (!event) return new Response("event not found", { status: 404 });

  const { data: payment } = await svc
    .from("payments")
    .select("amount_inr, status, utr, verified_at, verified_by")
    .eq("registration_id", reg.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let verifierName: string | null = null;
  if (payment?.verified_by) {
    const { data: prof } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", payment.verified_by)
      .maybeSingle();
    verifierName = prof?.full_name ?? null;
  }

  const doc = (
    <AcknowledgementDoc
      event={{
        name: event.name,
        starts_at: event.starts_at,
        primary_color: event.primary_color,
        accent_color: event.accent_color,
        text_on_primary: event.text_on_primary,
        id_card_org_name: event.id_card_org_name,
        id_card_event_title: event.id_card_event_title,
        id_card_footer: event.id_card_footer,
        payment_mode:
          (event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ??
          "online_upi",
      }}
      reg={{
        chest_no: reg.chest_no,
        full_name: reg.full_name,
        initial: (reg as { initial: string | null }).initial ?? null,
        division: reg.division,
        declared_weight_kg: reg.declared_weight_kg,
        district: reg.district,
        team: reg.team,
        registered_at: reg.created_at,
      }}
      payment={{
        amount_inr: payment?.amount_inr ?? null,
        status: payment?.status ?? "pending",
        utr: payment?.utr ?? null,
        verified_at: payment?.verified_at ?? null,
        verifier_name: verifierName,
      }}
    />
  );

  const stream = await renderToStream(doc);
  const filename = `acknowledgement-CHEST${String(reg.chest_no ?? 0).padStart(4, "0")}.pdf`;
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

type AckEvent = {
  name: string;
  starts_at: string | null;
  primary_color: string | null;
  accent_color: string | null;
  text_on_primary: string | null;
  id_card_org_name: string | null;
  id_card_event_title: string | null;
  id_card_footer: string | null;
  payment_mode: "online_upi" | "offline" | "hybrid";
};

type AckReg = {
  chest_no: number | null;
  full_name: string | null;
  initial: string | null;
  division: string | null;
  declared_weight_kg: number | null;
  district: string | null;
  team: string | null;
  registered_at: string | null;
};

type AckPayment = {
  amount_inr: number | null;
  status: string;
  utr: string | null;
  verified_at: string | null;
  verifier_name: string | null;
};

function AcknowledgementDoc({
  event,
  reg,
  payment,
}: {
  event: AckEvent;
  reg: AckReg;
  payment: AckPayment;
}) {
  const primary = event.primary_color ?? colors.moss;
  const accent = event.accent_color ?? colors.gold;
  const onPrimary = event.text_on_primary ?? "#ffffff";
  const isVerified = payment.status === "verified";
  // Unverified copy depends on how the event collects money: pure-offline
  // events never ask for a UTR, so "AWAITING PAYMENT" should read as
  // "PAY AT COUNTER" instead. Hybrid keeps the UTR-friendly wording but
  // mentions the counter as a fallback in the meta line below.
  const isOffline = event.payment_mode === "offline";
  const isHybrid = event.payment_mode === "hybrid";
  const unverifiedLabel =
    payment.status === "rejected"
      ? "REJECTED"
      : payment.utr
        ? "UNDER REVIEW"
        : isOffline
          ? "PAY AT COUNTER"
          : "AWAITING PAYMENT";

  return (
    <Document>
      <Page size="A4" style={{ padding: 36, fontSize: 10, color: colors.ink }}>
        {/* Header */}
        <View
          style={{
            backgroundColor: primary,
            color: onPrimary,
            padding: 16,
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 8, opacity: 0.85, letterSpacing: 2 }}>
            {(event.id_card_org_name ?? "ORGANISATION").toUpperCase()}
          </Text>
          <Text style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            {event.id_card_event_title ?? event.name}
          </Text>
          <Text style={{ fontSize: 9, opacity: 0.85, marginTop: 2 }}>
            REGISTRATION ACKNOWLEDGEMENT
          </Text>
        </View>

        {/* Chest number block */}
        <View
          style={{
            borderWidth: 2,
            borderColor: primary,
            padding: 18,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 8, letterSpacing: 2, color: "#666" }}>
            CHEST NUMBER
          </Text>
          <Text
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: primary,
              marginTop: 4,
              marginBottom: 6,
            }}
          >
            {String(reg.chest_no ?? 0).padStart(3, "0")}
          </Text>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>
            {reg.initial ? `${reg.initial}. ` : ""}
            {reg.full_name ?? ""}
          </Text>
          <Text style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
            {[reg.division, reg.declared_weight_kg ? `${reg.declared_weight_kg} kg` : null]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
          {(reg.district || reg.team) && (
            <Text style={{ fontSize: 9, color: "#666", marginTop: 2 }}>
              {[reg.district, reg.team].filter(Boolean).join("  ·  ")}
            </Text>
          )}
        </View>

        {/* Verification block */}
        <View
          style={{
            borderWidth: 1,
            borderColor: isVerified ? primary : "#999",
            padding: 14,
            marginBottom: 14,
          }}
        >
          <Text style={{ fontSize: 8, letterSpacing: 2, color: "#666" }}>
            PAYMENT STATUS
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: isVerified ? primary : "#a33",
              marginTop: 4,
            }}
          >
            {isVerified ? "VERIFIED" : unverifiedLabel}
          </Text>

          {!isVerified && (isOffline || isHybrid) && (
            <Text style={{ fontSize: 9, color: "#555", marginTop: 6 }}>
              {isOffline
                ? "This event collects fees in person. Quote your chest number at the registration counter."
                : "Pay via UPI before event day, or settle at the registration counter."}
            </Text>
          )}

          {isVerified && (
            <View style={{ marginTop: 10 }}>
              <Row label="Verified by" value={payment.verifier_name ?? "Tournament officials"} />
              <Row
                label="Verified at"
                value={fmtDate(payment.verified_at)}
              />
              {payment.amount_inr != null && (
                <Row label="Amount" value={`Rs. ${payment.amount_inr}`} />
              )}
              {payment.utr && <Row label="UTR / reference" value={payment.utr} />}
            </View>
          )}
        </View>

        {/* Event meta */}
        <View style={{ marginBottom: 14 }}>
          <Row label="Event" value={event.name} />
          {event.starts_at && (
            <Row label="Date" value={fmtDate(event.starts_at)} />
          )}
          {reg.registered_at && (
            <Row label="Registered" value={fmtDate(reg.registered_at)} />
          )}
        </View>

        {/* Footer band */}
        <View
          style={{
            position: "absolute",
            left: 36,
            right: 36,
            bottom: 36,
            borderTopWidth: 1,
            borderColor: accent,
            paddingTop: 8,
          }}
        >
          <Text style={{ fontSize: 8, color: "#666" }}>
            {event.id_card_footer ?? "Please carry this acknowledgement to weigh-in."}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 3 }}>
      <Text style={{ width: 110, fontSize: 9, color: "#666" }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 10 }}>{value}</Text>
    </View>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
