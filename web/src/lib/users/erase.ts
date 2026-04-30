/**
 * User hard-delete planning (GDPR/DPDP "right to erasure").
 *
 * The schema (after migration 0043) lets us truly delete a user without
 * destroying tournament history:
 *   - profiles → cascades to athletes (which IS the profile row, just
 *     extended) and removes the auth user.
 *   - registrations.athlete_id is now ON DELETE SET NULL, so the
 *     registration row survives. Display layers fall back to "Deleted
 *     athlete" for the snapshot fields.
 *   - All other FKs (events.created_by, payments.verified_by,
 *     weigh_ins.weighed_by, payment_collections.*, fixtures.updated_by,
 *     audit_log.actor_id, event_log.actor_id) are now ON DELETE SET NULL.
 *     Display layers render "Deleted user" when the join misses.
 *
 * This module is the pure decision layer. The route at
 * `/api/admin/users/[id]` orchestrates the actual writes.
 */

export type Role = "athlete" | "operator" | "super_admin";

export interface ErasureTarget {
  id: string;
  full_name: string | null;
  role: Role;
  /** Set when an erase is in progress (or stuck mid-pipeline). */
  erase_started_at: string | null;
}

export interface ErasureInput {
  target: ErasureTarget;
  /** ID of the super-admin invoking the erase. */
  actorId: string;
  /** Active super admins NOT counting the target. Used for last-super guard. */
  otherActiveSuperAdminCount: number;
}

export type ErasurePlan =
  | { ok: true; resume: boolean }
  | { ok: false; error: string };

/**
 * Decide whether to proceed with erasure. Pure — the caller does the I/O.
 *
 * `resume: true` means a previous erase started but never finished
 * (profile still exists with `erase_started_at` set). The caller should
 * re-run the same pipeline; every step is idempotent.
 */
export function planErasure(input: ErasureInput): ErasurePlan {
  const { target, actorId, otherActiveSuperAdminCount } = input;

  if (target.id === actorId) {
    return { ok: false, error: "cannot erase self" };
  }

  if (target.role === "super_admin" && otherActiveSuperAdminCount <= 0) {
    return { ok: false, error: "cannot erase the only remaining super admin" };
  }

  return { ok: true, resume: !!target.erase_started_at };
}

/**
 * Patch applied to `registrations` rows belonging to the erased athlete.
 * Replaces denormalized PII snapshots with a stable placeholder. The FK
 * `athlete_id` is left for the database to null on cascade (SET NULL).
 *
 * `gender`, `weight_class_code`, `division`, hand fields, etc. are kept
 * because they're tournament data, not personal data.
 */
export function buildRegistrationScrubPatch(): {
  full_name: string;
  initial: null;
  mobile: null;
  aadhaar: null;
  aadhaar_masked: null;
  photo_url: null;
  photo_bytes: null;
  dob: null;
  district: null;
  team: null;
} {
  return {
    full_name: "Deleted athlete",
    initial: null,
    mobile: null,
    aadhaar: null,
    aadhaar_masked: null,
    photo_url: null,
    photo_bytes: null,
    dob: null,
    district: null,
    team: null,
  };
}

/** Display fallback used by UI when a joined profile is null. */
export const DELETED_USER_LABEL = "Deleted user";
/** Display fallback used by UI for registrations whose athlete is gone. */
export const DELETED_ATHLETE_LABEL = "Deleted athlete";
