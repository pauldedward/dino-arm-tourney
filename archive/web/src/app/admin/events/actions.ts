"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createEvent(formData: FormData) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");

  const name = String(formData.get("name") ?? "").trim();
  const startsAt = String(formData.get("starts_at") ?? "");
  if (!name || !startsAt) throw new Error("Name + start date required");
  const slug = slugify(name) || `event-${Date.now()}`;
  const venue_city = String(formData.get("venue_city") ?? "").trim();
  const venue_state = String(formData.get("venue_state") ?? "Tamil Nadu").trim();
  const fee = Number(formData.get("entry_fee_inr") ?? 500);
  const upi_id = String(formData.get("upi_id") ?? "").trim();
  const upi_payee_name = String(formData.get("upi_payee_name") ?? "").trim();
  const rule_profile_id = String(formData.get("rule_profile_id") ?? "").trim() || null;

  const admin = createAdminClient();

  // Pick first organisation as default. Creating org UI is out of scope.
  const { data: org } = await admin.from("organizations").select("id").limit(1).maybeSingle();
  if (!org) throw new Error("No organisation exists. Seed one first.");

  // Slug uniqueness — append a short suffix if taken.
  let finalSlug = slug;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await admin.from("events").select("id").eq("slug", finalSlug).maybeSingle();
    if (!clash) break;
    finalSlug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { data: event, error } = await admin
    .from("events")
    .insert({
      organization_id: org.id,
      rule_profile_id,
      slug: finalSlug,
      name,
      status: "draft",
      starts_at: startsAt,
      venue_city: venue_city || null,
      venue_state: venue_state || null,
      entry_fee_inr: fee,
      entry_fee_default_inr: fee,
      upi_id: upi_id || null,
      upi_payee_name: upi_payee_name || null,
      hand: "both",
    })
    .select("id, slug")
    .single();
  if (error || !event) throw new Error(error?.message ?? "Insert failed");

  await recordAudit({
    action: "event.create",
    eventId: event.id,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: event.id,
    payload: { slug, name },
  });

  revalidatePath("/admin/events");
  redirect(`/admin/events/${event.id}`);
}

export async function publishEvent(eventId: string) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({
      registration_published_at: new Date().toISOString(),
      registration_closed_at: null,
      status: "open",
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.publish",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
  });
  revalidatePath(`/admin/events/${eventId}`);
}

export async function closeEvent(eventId: string) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({ registration_closed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.close_registration",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
  });
  revalidatePath(`/admin/events/${eventId}`);
}

export async function reopenEvent(eventId: string) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({ registration_closed_at: null })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.reopen_registration",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
  });
  revalidatePath(`/admin/events/${eventId}`);
}

export async function updateBranding(eventId: string, formData: FormData) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const patch = {
    primary_color: String(formData.get("primary_color") ?? "#0f3d2e"),
    accent_color: String(formData.get("accent_color") ?? "#f5c518"),
    text_on_primary: String(formData.get("text_on_primary") ?? "#ffffff"),
    id_card_org_name: String(formData.get("id_card_org_name") ?? "") || null,
    id_card_event_title: String(formData.get("id_card_event_title") ?? "") || null,
    id_card_subtitle: String(formData.get("id_card_subtitle") ?? "") || null,
    id_card_footer: String(formData.get("id_card_footer") ?? "") || null,
    id_card_signatory_name: String(formData.get("id_card_signatory_name") ?? "") || null,
    id_card_signatory_title: String(formData.get("id_card_signatory_title") ?? "") || null,
  };
  const { error } = await admin.from("events").update(patch).eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.branding.update",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
    payload: patch as unknown as Record<string, unknown>,
  });
  revalidatePath(`/admin/events/${eventId}/branding`);
}

// ─── Edit / archive / delete ───────────────────────────────────────────────

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function nNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function updateEvent(eventId: string, formData: FormData) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();

  const name = emptyToNull(formData.get("name"));
  const startsAt = emptyToNull(formData.get("starts_at"));
  if (!name || !startsAt) throw new Error("Name + start date required");

  // Slug change requires uniqueness check.
  let slug = emptyToNull(formData.get("slug"));
  if (slug) {
    slug = slugify(slug);
    const { data: existing } = await admin
      .from("events")
      .select("id")
      .eq("slug", slug)
      .neq("id", eventId)
      .maybeSingle();
    if (existing) throw new Error(`Slug "${slug}" is already taken`);
  }

  const hand = String(formData.get("hand") ?? "both");
  if (!["right", "left", "both"].includes(hand)) throw new Error("Invalid hand");

  const status = String(formData.get("status") ?? "draft");
  if (!["draft", "open", "live", "completed", "archived"].includes(status)) {
    throw new Error("Invalid status");
  }

  const patch: Record<string, unknown> = {
    name,
    starts_at: startsAt,
    ends_at: emptyToNull(formData.get("ends_at")),
    venue_name: emptyToNull(formData.get("venue_name")),
    venue_city: emptyToNull(formData.get("venue_city")),
    venue_state: emptyToNull(formData.get("venue_state")),
    description: emptyToNull(formData.get("description")),
    entry_fee_inr: nNum(formData.get("entry_fee_inr")) ?? 0,
    entry_fee_default_inr: nNum(formData.get("entry_fee_default_inr")) ?? 0,
    prize_pool_inr: nNum(formData.get("prize_pool_inr")) ?? 0,
    hand,
    status,
    rule_profile_id: emptyToNull(formData.get("rule_profile_id")),
    registration_opens_at: emptyToNull(formData.get("registration_opens_at")),
    registration_closes_at: emptyToNull(formData.get("registration_closes_at")),
    weigh_in_starts_at: emptyToNull(formData.get("weigh_in_starts_at")),
    weigh_in_ends_at: emptyToNull(formData.get("weigh_in_ends_at")),
    payment_provider: emptyToNull(formData.get("payment_provider")),
    upi_id: emptyToNull(formData.get("upi_id")),
    upi_payee_name: emptyToNull(formData.get("upi_payee_name")),
  };
  if (slug) patch.slug = slug;

  const { error } = await admin.from("events").update(patch).eq("id", eventId);
  if (error) throw new Error(error.message);

  await recordAudit({
    action: "event.update",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
    payload: { fields: Object.keys(patch) },
  });
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/admin/events/${eventId}/edit`);
  revalidatePath("/admin/events");
}

export async function archiveEvent(eventId: string) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({ status: "archived" })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.update",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
    payload: { archived: true },
  });
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
}

export async function unarchiveEvent(eventId: string) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({ status: "draft" })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await recordAudit({
    action: "event.update",
    eventId,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
    payload: { archived: false },
  });
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
}

/**
 * Hard delete. Refuses to drop an event that already has registrations —
 * archive it instead. Cascades wipe entries/fixtures/audit referencing this id.
 */
export async function deleteEvent(eventId: string, formData: FormData) {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) throw new Error("Forbidden");
  const confirmName = String(formData.get("confirm_name") ?? "").trim();

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, slug")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) throw new Error("Event not found");
  if (confirmName !== event.name) {
    throw new Error("Type the exact event name to confirm deletion");
  }

  const { count: regCount } = await admin
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);
  if ((regCount ?? 0) > 0) {
    throw new Error(
      `Cannot delete: ${regCount} registration(s) exist. Archive the event instead.`
    );
  }

  const { error } = await admin.from("events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);

  await recordAudit({
    action: "event.update",
    eventId: null,
    actorId: sess.user!.id,
    actorLabel: sess.fullName ?? sess.user!.email,
    targetTable: "events",
    targetId: eventId,
    payload: { deleted: true, slug: event.slug, name: event.name },
  });
  revalidatePath("/admin/events");
  redirect("/admin/events");
}
