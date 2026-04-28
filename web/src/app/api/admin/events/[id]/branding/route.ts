import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const ALLOWED_FIELDS = [
  "primary_color",
  "accent_color",
  "text_on_primary",
  "logo_url",
  "banner_url",
  "id_card_org_name",
  "id_card_event_title",
  "id_card_subtitle",
  "id_card_footer",
  "id_card_signatory_name",
  "id_card_signatory_title",
  "id_card_signature_url",
  "poster_url",
  "poster_kind",
] as const;

// Numeric overrides (PDF point sizes) - validated by DB CHECK constraint too.
const NUMERIC_FIELDS = [
  "id_card_org_name_size",
  "id_card_event_title_size",
] as const;

type Patch = Partial<
  Record<(typeof ALLOWED_FIELDS)[number], string | null> &
    Record<(typeof NUMERIC_FIELDS)[number], number | null>
>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", `/admin/events/${id}/branding`);

  const body = (await req.json()) as Record<string, unknown>;
  const patch: Patch = {};
  for (const k of ALLOWED_FIELDS) {
    const v = body[k];
    if (typeof v === "string") {
      patch[k] = v.trim() === "" ? null : v;
    } else if (v === null) {
      patch[k] = null;
    }
  }
  for (const k of NUMERIC_FIELDS) {
    const v = body[k];
    if (v === null || v === "" || v === undefined) {
      patch[k] = null;
    } else {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: `${k} must be numeric` }, { status: 400 });
      }
      patch[k] = Math.round(n);
    }
  }
  if (patch.poster_kind && patch.poster_kind !== "image" && patch.poster_kind !== "pdf") {
    return NextResponse.json({ error: "poster_kind must be image or pdf" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { error } = await svc.from("events").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    eventId: id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "event.branding_update",
    targetTable: "events",
    targetId: id,
    payload: patch,
  });

  return NextResponse.json({ ok: true });
}
