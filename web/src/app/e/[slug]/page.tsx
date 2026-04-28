import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import PendingLink from "@/components/PendingLink";
import PosterImage from "@/components/PosterImage";
import StickyRegisterCTA from "@/components/StickyRegisterCTA";
import { createClient } from "@/lib/db/supabase-server";
import LiveRefresh from "@/components/LiveRefresh";
import { BRAND_DEFAULT_ORG_LONG_NAME } from "@/lib/brand";

/**
 * Public event page — marketing + CTA. Lives at /e/<slug>.
 * Shows registration status, dates, venue, fee, and a big CTA to
 * /e/<slug>/register when the window is open.
 */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gone?: string }>;
}) {
  const { slug } = await params;
  const { gone } = await searchParams;
  const supabase = await createClient();

  // Event row + auth user are independent — fetch in parallel to halve RTT.
  const [eventRes, userRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, status, starts_at, ends_at, venue_name, venue_city, venue_state, entry_fee_default_inr, primary_color, accent_color, text_on_primary, logo_url, banner_url, id_card_org_name, id_card_event_title, id_card_subtitle, registration_published_at, registration_closed_at, upi_payee_name, payment_mode, description, poster_url, poster_kind, circular_url")
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

  const user = userRes.data.user;

  // If signed-in athlete already registered for this event, switch the CTA
  // to a 'view registration' deep-link instead of the register form.
  let existingRegToken: string | null = null;
  if (user) {
    const { data: existing } = await supabase
      .from("registrations")
      .select("public_token")
      .eq("event_id", event.id)
      .eq("athlete_id", user.id)
      .maybeSingle();
    existingRegToken = (existing?.public_token as string | undefined) ?? null;
  }

  const registerHref = user
    ? `/e/${slug}/register`
    : `/login?next=${encodeURIComponent(`/e/${slug}/register`)}`;
  const viewRegHref = existingRegToken
    ? `/e/${slug}/registered/${existingRegToken}`
    : null;

  const primary = event.primary_color ?? "#0f3d2e";
  const accent = event.accent_color ?? "#f5c518";
  const onPrimary = event.text_on_primary ?? "#ffffff";

  return (
    <main
      className="min-h-screen"
      style={
        {
          "--event-primary": primary,
          "--event-accent": accent,
          "--event-on-primary": onPrimary,
        } as React.CSSProperties
      }
    >
      <LiveRefresh tables={["events", "registrations"]} eventId={event.id} />
      {gone === "registration" && (
        <div className="border-b border-black/10 bg-rust/90 px-4 py-3 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-white sm:px-6">
          That registration is no longer available. It may have been removed by the organiser.
        </div>
      )}
      <header
        className="border-b border-black/10"
        style={{ background: primary, color: onPrimary }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <Link
            href="/"
            className="font-display text-xs italic opacity-70 hover:opacity-100 sm:text-sm"
          >
            ← all events
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Logo src={event.logo_url} size={32} />
            <span
              className="text-[9px] uppercase tracking-[0.25em] sm:text-[10px] sm:tracking-[0.3em]"
              style={{ color: accent }}
            >
              {event.id_card_org_name ?? BRAND_DEFAULT_ORG_LONG_NAME}
            </span>
          </div>
        </div>
      </header>

      <section
        className="relative overflow-hidden border-b border-black/10"
        style={{ background: primary, color: onPrimary }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rotate-12 opacity-10 sm:h-96 sm:w-96"
          style={{ background: accent, borderRadius: "50%" }}
        />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12 md:grid-cols-[1fr_minmax(0,360px)] md:gap-12 md:pb-20 md:pt-16 lg:grid-cols-[1fr_minmax(0,420px)]">
          {/* Text column */}
          <div className="relative order-2 md:order-1">
            <div
              className="inline-flex flex-wrap items-center gap-2"
            >
              <div
                className="inline-block border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em]"
                style={{ borderColor: `${onPrimary}40`, color: accent }}
              >
                {regOpen
                  ? "● Registration open"
                  : opensAt && opensAt > now
                    ? "Opens soon"
                    : "Registration closed"}
              </div>
              <Link
                href={`/e/${slug}/live`}
                prefetch
                className="group inline-flex items-center gap-2 border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] transition hover:bg-white/10"
                style={{ borderColor: accent, color: accent }}
              >
                <span aria-hidden className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ background: accent }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ background: accent }}
                  />
                </span>
                Watch live →
              </Link>
            </div>
            <h1 className="mt-4 font-display text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              {event.name}
            </h1>
            {event.id_card_subtitle && (
              <p
                className="mt-4 font-display text-xl italic sm:text-2xl md:text-3xl"
                style={{ color: accent }}
              >
                {event.id_card_subtitle}
              </p>
            )}

            <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 text-sm sm:mt-10 sm:grid-cols-2">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                  Date
                </dt>
                <dd className="mt-1 text-base sm:text-lg">
                  {new Date(event.starts_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                  Venue
                </dt>
                <dd className="mt-1 text-base sm:text-lg">
                  {event.venue_name ?? "TBA"}
                  <br />
                  <span className="opacity-70">
                    {event.venue_city ?? ""}
                    {event.venue_state ? `, ${event.venue_state}` : ""}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.25em] opacity-60">
                  Entry fee
                </dt>
                <dd className="mt-1 text-base sm:text-lg">
                  ₹{event.entry_fee_default_inr ?? 500}{" "}
                  <span className="opacity-60">per hand</span>
                  {event.payment_mode === "offline" && (
                    <span
                      className="ml-2 inline-block border px-2 py-0.5 align-middle font-mono text-[9px] uppercase tracking-[0.2em]"
                      style={{ borderColor: accent, color: accent }}
                    >
                      Pay at venue
                    </span>
                  )}
                  {event.payment_mode === "hybrid" && (
                    <span
                      className="ml-2 inline-block border px-2 py-0.5 align-middle font-mono text-[9px] uppercase tracking-[0.2em]"
                      style={{ borderColor: accent, color: accent }}
                    >
                      UPI or counter
                    </span>
                  )}
                </dd>
                <p className="mt-1 text-[11px] opacity-60">
                  {event.payment_mode === "offline"
                    ? "Hand fee to your district secretary or pay cash / UPI at the registration counter."
                    : "Final amount may vary by class/concession."}
                </p>
              </div>
            </dl>

            {regOpen && (
              <div className="mt-10 hidden md:block">
                <PendingLink
                  href={viewRegHref ?? registerHref}
                  prefetch
                  pendingLabel="Loading…"
                  className="group relative inline-flex items-center gap-4 px-8 py-5 text-base font-black uppercase tracking-[0.2em] shadow-[6px_6px_0_0_rgba(0,0,0,0.25)] transition hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_rgba(0,0,0,0.3)]"
                  style={{ background: accent, color: primary }}
                >
                  <span
                    aria-hidden
                    className="relative flex h-2.5 w-2.5"
                  >
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                      style={{ background: primary }}
                    />
                    <span
                      className="relative inline-flex h-2.5 w-2.5 rounded-full"
                      style={{ background: primary }}
                    />
                  </span>
                  {viewRegHref
                    ? "View registration"
                    : user
                      ? "Register now"
                      : "Sign in to register"}
                  <span aria-hidden className="text-2xl transition group-hover:translate-x-1">
                    →
                  </span>
                </PendingLink>
                <p className="mt-3 max-w-md text-xs opacity-60">
                  {viewRegHref
                    ? "You're already in. Tap to view your chest number, payment, or edit details."
                    : user
                      ? `Takes ~3 minutes · ₹${event.entry_fee_default_inr ?? 500} per hand${event.payment_mode === "offline" ? " · pay at venue" : " via UPI"} · final fee confirmed by organiser`
                      : "One athlete account, one registration per event."}
                </p>
              </div>
            )}
          </div>

          {/* Poster column */}
          {event.poster_url && (
            <div className="order-1 md:order-2">
              <div
                className="border-2 shadow-2xl"
                style={{ borderColor: accent }}
              >
                {event.poster_kind === "pdf" ? (
                  <a
                    href={event.poster_url}
                    target="_blank"
                    rel="noopener"
                    className="group flex aspect-[3/4] flex-col items-center justify-center gap-3 bg-bone px-4 py-8 text-center text-ink hover:bg-kraft/30"
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-60">
                      Event poster
                    </div>
                    <div className="font-display text-3xl font-black sm:text-4xl">
                      PDF
                    </div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.25em] underline group-hover:no-underline">
                      Tap to open ↗
                    </div>
                  </a>
                ) : (
                  <PosterImage
                    url={event.poster_url}
                    alt={`${event.name} poster`}
                    className="group relative block w-full overflow-hidden bg-bone"
                  />
                )}
              </div>
              <p
                className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.25em] opacity-60"
              >
                {event.poster_kind === "pdf"
                  ? "Tap card to open PDF"
                  : "Tap poster to zoom"}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Unified details strip: description + circular share one section so the
          page feels composed instead of two stray cards floating beneath the hero. */}
      {(event.description || event.circular_url) && (
        <section className="border-b border-ink/10 bg-bone">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-[1fr_minmax(0,300px)] md:gap-12 lg:grid-cols-[1fr_minmax(0,340px)]">
            {event.description ? (
              <div className="min-w-0">
                <h2
                  className="font-mono text-[10px] uppercase tracking-[0.3em]"
                  style={{ color: primary }}
                >
                  About this event
                </h2>
                <div className="prose mt-4 max-w-none whitespace-pre-line text-ink/85">
                  {event.description}
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <h2
                  className="font-mono text-[10px] uppercase tracking-[0.3em]"
                  style={{ color: primary }}
                >
                  Need the full details?
                </h2>
                <p className="mt-4 font-display text-2xl leading-snug text-ink sm:text-3xl">
                  Everything an athlete needs — weight categories, fees, schedule, contact — lives in the official circular.
                </p>
              </div>
            )}

            {event.circular_url && (
              <aside className="md:sticky md:top-6 md:self-start">
                <a
                  href={event.circular_url}
                  target="_blank"
                  rel="noopener"
                  className="group block border-2 border-ink bg-white p-5 transition hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_rgba(10,27,20,0.9)] sm:p-6"
                >
                  <div className="flex items-start gap-4">
                    <div
                      aria-hidden
                      className="flex h-12 w-12 shrink-0 items-center justify-center font-mono text-[10px] font-bold uppercase tracking-[0.15em] sm:h-14 sm:w-14"
                      style={{ background: primary, color: onPrimary }}
                    >
                      PDF
                    </div>
                    <div className="min-w-0">
                      <div
                        className="font-mono text-[10px] uppercase tracking-[0.3em]"
                        style={{ color: primary }}
                      >
                        Official circular
                      </div>
                      <div className="mt-1 font-display text-lg font-semibold leading-tight text-ink sm:text-xl">
                        Rules, weights &amp; fees
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-5 flex items-center justify-between border-t-2 pt-3 font-mono text-[11px] uppercase tracking-[0.25em]"
                    style={{ borderColor: primary, color: primary }}
                  >
                    <span>Download PDF</span>
                    <span aria-hidden className="text-lg transition group-hover:translate-x-1">
                      ↓
                    </span>
                  </div>
                </a>
              </aside>
            )}
          </div>
        </section>
      )}

      {/* Mobile sticky CTA — always visible at bottom on small screens when reg open */}
      {regOpen && (
        <>
          <StickyRegisterCTA
            href={viewRegHref ?? registerHref}
            label={
              viewRegHref
                ? "View registration"
                : user
                  ? "Register now"
                  : "Sign in to register"
            }
            sublabel={
              viewRegHref
                ? undefined
                : user
                  ? `₹${event.entry_fee_default_inr ?? 500}/hand${event.payment_mode === "offline" ? " · at venue" : " via UPI"}`
                  : undefined
            }
            primary={primary}
            accent={accent}
            onPrimary={onPrimary}
          />
          <div aria-hidden className="h-24 md:hidden" />
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t-2 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] md:hidden"
            style={{ background: primary, color: onPrimary, borderColor: accent }}
          >
            <PendingLink
              href={viewRegHref ?? registerHref}
              prefetch
              pendingLabel="Loading…"
              className="flex w-full items-center justify-center gap-3 bg-[var(--event-accent)] px-6 py-4 text-sm font-black uppercase tracking-[0.2em] text-[var(--event-primary)]"
            >
              <span
                aria-hidden
                className="relative flex h-2 w-2"
              >
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: primary }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: primary }}
                />
              </span>
              {viewRegHref
                ? "View registration"
                : user
                  ? `Register · ₹${event.entry_fee_default_inr ?? 500}/hand${event.payment_mode === "offline" ? " · at venue" : ""}`
                  : "Sign in to register"}
              <span aria-hidden>→</span>
            </PendingLink>
          </div>
        </>
      )}
    </main>
  );
}
