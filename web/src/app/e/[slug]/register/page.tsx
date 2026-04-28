import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/supabase-server";
import { createServiceClient } from "@/lib/db/supabase-service";
import RegisterForm from "./RegisterForm";

/**
 * Registration form shell. Gates on the event being open — returns the
 * athlete to the event page if the window has closed. Also requires a
 * signed-in athlete account so one athlete = one registration per event.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  // Stage 1: event + auth user are independent — fetch in parallel.
  const [eventRes, userRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, starts_at, entry_fee_default_inr, payment_mode, primary_color, accent_color, text_on_primary, registration_published_at, registration_closed_at, id_card_subtitle, id_card_org_name, poster_url, poster_kind")
      .eq("slug", slug)
      .neq("status", "draft")
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  const event = eventRes.data;
  if (!event) redirect("/?gone=event");

  const now = Date.now();
  const opensAt = event.registration_published_at
    ? new Date(event.registration_published_at).getTime()
    : null;
  const closesAt = event.registration_closed_at
    ? new Date(event.registration_closed_at).getTime()
    : null;
  const regOpen =
    opensAt !== null && opensAt <= now && (closesAt === null || closesAt > now);

  if (!regOpen) redirect(`/e/${slug}`);

  // Require signed-in athlete. Bounce to /login with next= so they return
  // here after auth.
  const user = userRes.data.user;
  const nextPath = `/e/${slug}/register`;
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // Stage 2: existing-registration check + profile load both depend on
  // user.id but are independent of each other.
  const svc = createServiceClient();
  const [existingRes, profileRes] = await Promise.all([
    svc
      .from("registrations")
      .select("public_token")
      .eq("event_id", event.id)
      .eq("athlete_id", user.id)
      .maybeSingle(),
    svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const existing = existingRes.data;
  if (existing) {
    redirect(`/e/${slug}/registered/${existing.public_token}`);
  }
  const profile = profileRes.data;

  return (
    <RegisterForm
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
