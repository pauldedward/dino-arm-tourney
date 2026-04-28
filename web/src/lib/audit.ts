import { createServiceClient } from "./db/supabase-service";

/**
 * Append-only audit log writer.
 *
 * Every state-changing route calls this with:
 *   - the actor's profile id (operator / super admin)
 *   - a stable action string (`payment.verify`, `event.publish`, ...)
 *   - the affected table + id
 *   - a JSON payload summarising what changed
 *
 * Writes use the service-role client so RLS doesn't silently drop rows
 * (the `audit_log_insert_any` policy would allow it anyway, but this is
 * cheaper and can't be tampered with by a hostile operator session).
 */
export interface AuditInput {
  eventId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  clientIp?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc.from("audit_log").insert({
    event_id: input.eventId ?? null,
    actor_id: input.actorId ?? null,
    actor_label: input.actorLabel ?? null,
    action: input.action,
    target_table: input.targetTable ?? null,
    target_id: input.targetId ?? null,
    payload: input.payload ?? null,
    client_ip: input.clientIp ?? null,
  });
  if (error) {
    // Audit failures are logged but do not fail the parent request — the
    // request's primary work has already committed. An operator rebuilding
    // the timeline can cross-check against event_log for high-value topics.
    console.error("[audit] insert failed", error);
  }
}
