import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import RegisterForm, { type RegisterPrefill } from "../../../register/RegisterForm";
import type { Hand } from "@/lib/rules/registration-rules";

export const dynamic = "force-dynamic";

/**
 * Athlete-side edit page. Owner only, only while reg is pending/paid and
 * registration window is still open. Server-side guard mirrors PATCH API.
 */
export default async function EditRegistrationPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/e/${slug}/registered/${token}/edit`)}`
    );
  }

  const svc = createServiceClient();
  const { data: reg } = await svc
    .from("registrations")
    .select(
      "id, public_token, event_id, athlete_id, status, full_name, initial, dob, gender, mobile, aadhaar_masked, affiliation_kind, district, team, declared_weight_kg, nonpara_classes, nonpara_hands, para_codes, para_hand"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!reg) redirect(`/e/${slug}?gone=registration`);
  if (reg.athlete_id !== user.id) {
    redirect(`/e/${slug}/registered/${token}`);
  }
  if (reg.status !== "pending" && reg.status !== "paid") {
    redirect(`/e/${slug}/registered/${token}`);
  }

  const { data: event } = await svc
    .from("events")
    .select(
      "id, slug, name, starts_at, entry_fee_default_inr, payment_mode, primary_color, accent_color, text_on_primary, registration_published_at, registration_closed_at, id_card_subtitle, id_card_org_name, poster_url, poster_kind"
    )
    .eq("id", reg.event_id)
    .maybeSingle();
  if (!event) redirect("/?gone=event");
  if (event.slug !== slug) redirect(`/e/${event.slug}/registered/${token}/edit`);

  const now = Date.now();
  const opensAt = event.registration_published_at
    ? new Date(event.registration_published_at).getTime()
    : null;
  const closesAt = event.registration_closed_at
    ? new Date(event.registration_closed_at).getTime()
    : null;
  const regOpen =
    opensAt !== null && opensAt <= now && (closesAt === null || closesAt > now);
  if (!regOpen) redirect(`/e/${slug}/registered/${token}`);

  // Block edits once any payment is verified — once accounts have signed
  // off, the registration row is effectively immutable.
  const { data: verifiedPay } = await svc
    .from("payments")
    .select("id")
    .eq("registration_id", reg.id)
    .eq("status", "verified")
    .limit(1)
    .maybeSingle();
  if (verifiedPay) redirect(`/e/${slug}/registered/${token}`);

  const { data: profile } = await svc
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  // Rebuild hand map { className: hand } from the parallel arrays stored on
  // the row (DB stores nonpara_classes[] alongside nonpara_hands[]).
  const classes = (reg.nonpara_classes as string[] | null) ?? [];
  const hands = (reg.nonpara_hands as Hand[] | null) ?? [];
  const handMap: Record<string, Hand> = {};
  classes.forEach((c, i) => {
    if (hands[i]) handMap[c] = hands[i];
  });

  const prefill: RegisterPrefill = {
    publicToken: reg.public_token as string,
    full_name: reg.full_name ?? "",
    initial: reg.initial ?? "",
    dob: reg.dob ?? "",
    gender: (reg.gender as "M" | "F") ?? "",
    mobile: reg.mobile ?? "",
    aadhaar_masked: reg.aadhaar_masked ?? null,
    affiliation_kind:
      (reg.affiliation_kind as "District" | "Team") ?? "District",
    district: reg.district ?? "",
    team: reg.team ?? "",
    declared_weight_kg: reg.declared_weight_kg ?? null,
    nonpara_classes: classes,
    nonpara_hands: handMap,
    para_codes: (reg.para_codes as string[] | null) ?? [],
    para_hand: (reg.para_hand as Hand) ?? "",
  };

  return (
    <RegisterForm
      mode="edit"
      prefill={prefill}
      event={{
        id: event.id,
        slug: event.slug,
        name: event.name,
        starts_at: event.starts_at,
        entry_fee_inr: event.entry_fee_default_inr ?? 500,
        payment_mode: (event.payment_mode as "online_upi" | "offline" | "hybrid" | null) ?? "online_upi",
        primary_color: event.primary_color ?? "#0f3d2e",
        accent_color: event.accent_color ?? "#f5c518",
        text_on_primary: event.text_on_primary ?? "#ffffff",
        subtitle: event.id_card_subtitle ?? "",
        org_name: event.id_card_org_name ?? "TNAWA",
        poster_url: event.poster_url ?? null,
        poster_kind: (event.poster_kind ?? null) as "image" | "pdf" | null,
      }}
      athlete={{
        email: profile?.email ?? user.email ?? "",
        full_name: profile?.full_name ?? "",
      }}
    />
  );
}
