import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  organization_id: string;
  name: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  description: string | null;
  entry_fee_default_inr: number;
  upi_id: string | null;
  upi_payee_name: string | null;
  payment_mode?: "online_upi" | "offline" | "hybrid";
}

/**
 * Creates a new event in `draft` status. Super-admin only.
 *
 * Branding (colours, ID-card text), operator invites, and file uploads
 * (poster / circular) are configured separately on the event edit page —
 * the create form keeps to the minimum required fields.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "/admin/events/new");
  const body = (await req.json()) as Body;

  if (!body.organization_id || !body.name || !body.slug || !body.starts_at) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!/^[a-z0-9-]{3,60}$/.test(body.slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const svc = createServiceClient();

  const { data: existing } = await svc
    .from("events")
    .select("id")
    .eq("slug", body.slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "slug already in use" }, { status: 409 });
  }

  const { data: created, error } = await svc
    .from("events")
    .insert({
      organization_id: body.organization_id,
      slug: body.slug,
      name: body.name,
      status: "draft",
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      venue_name: body.venue_name,
      venue_city: body.venue_city,
      venue_state: body.venue_state,
      description: body.description,
      entry_fee_default_inr: body.entry_fee_default_inr,
      upi_id: body.upi_id,
      upi_payee_name: body.upi_payee_name,
      payment_mode: body.payment_mode ?? "online_upi",
      created_by: session.userId,
    })
    .select("id, slug")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  await recordAudit({
    eventId: created.id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: "event.create",
    targetTable: "events",
    targetId: created.id,
    payload: { slug: created.slug, name: body.name },
  });

  return NextResponse.json({ id: created.id, slug: created.slug });
}
