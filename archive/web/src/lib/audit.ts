import { createAdminClient } from "@/lib/supabase/admin";
import { headers } from "next/headers";

export type AuditAction =
  // Public
  | "registration.create"
  | "payment.proof.submit"
  // Operator
  | "registration.update"
  | "registration.delete"
  | "payment.verify"
  | "payment.reject"
  | "weighin.record"
  | "fixtures.generate"
  // Super admin
  | "event.create"
  | "event.update"
  | "event.publish"
  | "event.close_registration"
  | "event.reopen_registration"
  | "event.branding.update"
  | "user.invite"
  | "user.role.change"
  | "user.promote_super"
  | "user.disable"
  | "user.enable"
  | "user.delete";

export type AuditInput = {
  action: AuditAction;
  eventId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  targetTable?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
};

/**
 * Best-effort audit insert. Never throws into the request path —
 * failure to log must not 500 a real action.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const admin = createAdminClient();
    let ip: string | null = null;
    try {
      const h = await headers();
      ip =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null;
    } catch {
      // Outside request context (e.g. seed script).
    }
    await admin.from("audit_log").insert({
      action: input.action,
      event_id: input.eventId ?? null,
      actor_id: input.actorId ?? null,
      actor_label: input.actorLabel ?? null,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      payload: input.payload ?? null,
      client_ip: ip,
    });
  } catch (err) {
    console.error("[audit] failed:", err);
  }
}
