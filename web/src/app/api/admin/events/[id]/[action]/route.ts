import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

type Action = "publish" | "close_registrations" | "reopen" | "archive";

const ALLOWED: Action[] = ["publish", "close_registrations", "reopen", "archive"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  if (!ALLOWED.includes(action as Action)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const session = await requireRole("super_admin", `/admin/events/${id}`);

  const svc = createServiceClient();
  const now = new Date().toISOString();

  // Build the patch per action.
  const patch: Record<string, unknown> = {};
  if (action === "publish") {
    patch.status = "open";
    patch.registration_published_at = now;
    patch.registration_closed_at = null;
  } else if (action === "close_registrations") {
    patch.registration_closed_at = now;
  } else if (action === "reopen") {
    patch.registration_closed_at = null;
    if (!(await hasPublishTimestamp(svc, id))) {
      patch.registration_published_at = now;
    }
    patch.status = "open";
  } else if (action === "archive") {
    patch.status = "archived";
  }

  const { error } = await svc.from("events").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    eventId: id,
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    action: `event.${action}`,
    targetTable: "events",
    targetId: id,
    payload: patch,
  });

  return NextResponse.json({ ok: true });
}

async function hasPublishTimestamp(
  svc: ReturnType<typeof createServiceClient>,
  id: string
): Promise<boolean> {
  const { data } = await svc
    .from("events")
    .select("registration_published_at")
    .eq("id", id)
    .maybeSingle();
  return !!data?.registration_published_at;
}
