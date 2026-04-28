import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Allow-list of columns that can be PATCHed by a super-admin from the event
 * edit page. Anything not in this set is silently dropped to keep the API
 * narrow and predictable.
 */
const PATCHABLE = new Set([
  // Basics
  "name",
  "starts_at",
  "ends_at",
  "venue_name",
  "venue_city",
  "venue_state",
  "description",
  // Payment
  "entry_fee_default_inr",
  "entry_fee_offline_inr",
  "upi_id",
  "upi_payee_name",
  "payment_mode",
  // Files
  "poster_url",
  "poster_kind",
  "circular_url",
  "logo_url",
  "banner_url",
  "id_card_signature_url",
  // Format
  "bracket_format",
  // Branding / ID-card
  "primary_color",
  "accent_color",
  "text_on_primary",
  "id_card_org_name",
  "id_card_event_title",
  "id_card_subtitle",
  "id_card_footer",
  "id_card_signatory_name",
  "id_card_signatory_title",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", `/admin/events/${id}`);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    // Coerce empty/invalid offline-fee inputs to null so the form's blank
    // input means "no override" and not "₹0".
    if (k === "entry_fee_offline_inr") {
      if (v === "" || v == null) {
        patch[k] = null;
        continue;
      }
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "entry_fee_offline_inr must be a non-negative integer or blank" },
          { status: 400 }
        );
      }
      patch[k] = Math.round(n);
      continue;
    }
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { error } = await svc.from("events").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    eventId: id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "event.update",
    targetTable: "events",
    targetId: id,
    payload: patch,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", "/admin/events");
  const svc = createServiceClient();

  const { data: ev } = await svc
    .from("events")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await svc.from("events").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    eventId: null,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "event.delete",
    targetTable: "events",
    targetId: id,
    payload: { name: ev.name, slug: ev.slug },
  });

  return NextResponse.json({ ok: true });
}
