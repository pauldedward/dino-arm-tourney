import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { recordAudit } from "@/lib/audit";
import { deleteObject } from "@/lib/storage";
import { planErasure, buildRegistrationScrubPatch, type ErasureTarget } from "@/lib/users/erase";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * DELETE /api/admin/users/[id]
 *
 * Hard-delete a user. After migration 0043 the FK chain is loose enough
 * that `auth.admin.deleteUser` cascades through profiles → athletes
 * cleanly without nuking tournament rows. We only have to:
 *   1. Stamp `profiles.erase_started_at` (stuck-erase marker).
 *   2. Scrub denormalized PII from registrations + null payment/proof
 *      URLs and weigh-in photos.
 *   3. Best-effort delete R2 objects (photos, proofs).
 *   4. Audit-log `user.erase` (with actor name snapshot).
 *   5. `auth.admin.deleteUser` — cascades the rest.
 *
 * Every step is idempotent so re-running on a stuck profile finishes
 * cleanly. After the requested user, we opportunistically sweep up to 5
 * other profiles whose erase started but never completed.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireRole("super_admin", "/admin/users");

  const svc = createServiceClient();

  const result = await eraseOne(svc, id, {
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Opportunistic sweep — finish any previously-stuck erasures.
  const sweep = await sweepStuckErasures(svc, {
    actorId: session.userId,
    actorLabel: session.fullName ?? session.email,
    excludeId: id,
    max: 5,
  });

  return NextResponse.json({
    ok: true,
    registrations_anonymized: result.registrationsCount,
    r2_objects_purged: result.r2Count,
    swept: sweep.completed,
    sweep_failures: sweep.failed,
  });
}

interface ActorContext {
  actorId: string;
  actorLabel: string;
}

interface EraseSuccess {
  ok: true;
  registrationsCount: number;
  r2Count: number;
}
interface EraseFailure {
  ok: false;
  status: number;
  error: string;
}

async function eraseOne(
  svc: SupabaseClient,
  id: string,
  actor: ActorContext
): Promise<EraseSuccess | EraseFailure> {
  const { data: profile } = await svc
    .from("profiles")
    .select("id, full_name, role, erase_started_at")
    .eq("id", id)
    .maybeSingle();
  if (!profile) {
    return { ok: false, status: 404, error: "not found" };
  }

  const { count: othersCount } = await svc
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "super_admin")
    .is("disabled_at", null)
    .neq("id", id);

  const decision = planErasure({
    target: profile as ErasureTarget,
    actorId: actor.actorId,
    otherActiveSuperAdminCount: othersCount ?? 0,
  });
  if (!decision.ok) {
    return { ok: false, status: 400, error: decision.error };
  }

  const fullNameSnapshot = profile.full_name ?? null;
  const previousRole = profile.role as string;

  // 1. Stamp marker (idempotent — preserves the original timestamp on resume).
  if (!profile.erase_started_at) {
    await svc
      .from("profiles")
      .update({ erase_started_at: new Date().toISOString() })
      .eq("id", id);
  }

  // 2. Collect registrations + their R2 photo keys.
  const { data: regs } = await svc
    .from("registrations")
    .select("id, photo_url")
    .eq("athlete_id", id);
  const regIds = (regs ?? []).map((r) => r.id as string);
  const regPhotoKeys = (regs ?? [])
    .map((r) => r.photo_url as string | null)
    .filter((k): k is string => !!k);

  // 3. Scrub PII snapshots on registrations.
  if (regIds.length > 0) {
    await svc.from("registrations").update(buildRegistrationScrubPatch()).in("id", regIds);
  }

  // 4. Weigh-ins: collect + null photo URLs.
  let weighPhotoKeys: string[] = [];
  if (regIds.length > 0) {
    const { data: weighs } = await svc
      .from("weigh_ins")
      .select("id, live_photo_url, scale_photo_url")
      .in("registration_id", regIds);
    weighPhotoKeys = (weighs ?? []).flatMap((w) =>
      [w.live_photo_url as string | null, w.scale_photo_url as string | null].filter(
        (k): k is string => !!k
      )
    );
    await svc
      .from("weigh_ins")
      .update({ live_photo_url: null, scale_photo_url: null })
      .in("registration_id", regIds);
  }

  // 5. Payments + payment_proofs.
  let proofPhotoKeys: string[] = [];
  if (regIds.length > 0) {
    const { data: payments } = await svc
      .from("payments")
      .select("id, proof_url")
      .in("registration_id", regIds);
    const paymentIds = (payments ?? []).map((p) => p.id as string);
    proofPhotoKeys.push(
      ...(payments ?? [])
        .map((p) => p.proof_url as string | null)
        .filter((k): k is string => !!k)
    );
    if (paymentIds.length > 0) {
      const { data: proofs } = await svc
        .from("payment_proofs")
        .select("id, proof_url")
        .in("payment_id", paymentIds);
      proofPhotoKeys.push(
        ...(proofs ?? [])
          .map((p) => p.proof_url as string | null)
          .filter((k): k is string => !!k)
      );
      await svc
        .from("payments")
        .update({ proof_url: null, utr: null })
        .in("id", paymentIds);
      await svc
        .from("payment_proofs")
        .update({ proof_url: null, utr: null })
        .in("payment_id", paymentIds);
    }
  }

  // 6. R2 purge — best-effort.
  const allKeys = [...regPhotoKeys, ...weighPhotoKeys, ...proofPhotoKeys];
  await Promise.all(
    allKeys.map((key) =>
      deleteObject("private", key).catch((e: unknown) => {
        console.warn(`erase: r2 delete failed for ${key}`, e);
      })
    )
  );

  // 7. Audit log first — so the record exists even if auth-delete fails.
  //    The audit row references `target_id` as a plain UUID; once
  //    profiles is gone, target_id is a dangling reference (not an FK).
  await recordAudit({
    actorId: actor.actorId,
    actorLabel: actor.actorLabel,
    action: "user.erase",
    targetTable: "profiles",
    targetId: id,
    payload: {
      previous_role: previousRole,
      full_name_at_erase: fullNameSnapshot,
      registrations_anonymized: regIds.length,
      r2_objects_purged: allKeys.length,
    },
  });

  // 8. Hard-delete the auth user. Cascades:
  //      auth.users → profiles → athletes
  //    Loose FKs (registrations.athlete_id, payments.verified_by, etc.)
  //    become NULL automatically thanks to migration 0043.
  const { error: authErr } = await svc.auth.admin.deleteUser(id);
  if (authErr && !/not.?found|does not exist|user_not_found/i.test(authErr.message)) {
    // Auth delete failed for an unexpected reason. Marker stays set so
    // the next sweep retries.
    return { ok: false, status: 500, error: `auth.deleteUser: ${authErr.message}` };
  }

  return { ok: true, registrationsCount: regIds.length, r2Count: allKeys.length };
}

interface SweepInput extends ActorContext {
  excludeId: string;
  max: number;
}

interface SweepResult {
  completed: number;
  failed: number;
}

async function sweepStuckErasures(
  svc: SupabaseClient,
  input: SweepInput
): Promise<SweepResult> {
  const { data: stuck } = await svc
    .from("profiles")
    .select("id")
    .not("erase_started_at", "is", null)
    .neq("id", input.excludeId)
    .limit(input.max);

  let completed = 0;
  let failed = 0;
  for (const row of stuck ?? []) {
    try {
      const r = await eraseOne(svc, row.id as string, {
        actorId: input.actorId,
        actorLabel: input.actorLabel,
      });
      if (r.ok) completed++;
      else failed++;
    } catch (e) {
      console.warn("erase sweep: unexpected failure", e);
      failed++;
    }
  }
  return { completed, failed };
}
