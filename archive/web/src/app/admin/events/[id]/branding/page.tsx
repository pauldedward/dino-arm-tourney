import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { updateBranding } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) redirect(`/admin/events/${id}`);
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("*").eq("id", id).maybeSingle();
  if (!event) notFound();

  async function save(formData: FormData) {
    "use server";
    await updateBranding(id, formData);
  }

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${id}`} className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink">
        ← {event.name}
      </Link>
      <h1 className="font-display text-5xl tracking-tight2">Branding & ID card</h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <form action={save} className="space-y-5 border-2 border-ink p-6">
          <fieldset className="space-y-3">
            <legend className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              Colours
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <Color name="primary_color" label="Primary" defaultValue={event.primary_color ?? "#0f3d2e"} />
              <Color name="accent_color" label="Accent" defaultValue={event.accent_color ?? "#f5c518"} />
              <Color name="text_on_primary" label="Text on primary" defaultValue={event.text_on_primary ?? "#ffffff"} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
              ID card content
            </legend>
            <Field name="id_card_org_name" label="Organisation name" defaultValue={event.id_card_org_name ?? ""} />
            <Field name="id_card_event_title" label="Event title" defaultValue={event.id_card_event_title ?? ""} />
            <Field name="id_card_subtitle" label="Subtitle" defaultValue={event.id_card_subtitle ?? ""} />
            <Field name="id_card_footer" label="Footer" defaultValue={event.id_card_footer ?? ""} />
            <div className="grid grid-cols-2 gap-3">
              <Field name="id_card_signatory_name" label="Signatory name" defaultValue={event.id_card_signatory_name ?? ""} />
              <Field name="id_card_signatory_title" label="Signatory title" defaultValue={event.id_card_signatory_title ?? ""} />
            </div>
          </fieldset>

          <button className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood">
            Save branding
          </button>
        </form>

        <aside className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
            Live preview
          </p>
          <div
            className="border-2 border-ink p-4"
            style={{ backgroundColor: event.primary_color ?? "#0f3d2e", color: event.text_on_primary ?? "#fff" }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] opacity-80">
              {event.id_card_org_name ?? "Organisation"}
            </p>
            <p className="mt-1 font-display text-xl tracking-tight2">
              {event.id_card_event_title ?? event.name}
            </p>
            {event.id_card_subtitle && (
              <p className="mt-1 font-mono text-[10px] opacity-80">{event.id_card_subtitle}</p>
            )}
            <div className="mt-4 h-32 w-24 border" style={{ borderColor: event.accent_color ?? "#f5c518" }}>
              <p className="grid h-full place-items-center font-mono text-[10px] opacity-60">PHOTO</p>
            </div>
            <p className="mt-3 font-display text-2xl tnum tracking-tight2">#1001</p>
            <p className="font-mono text-xs">SAMPLE NAME</p>
            <p className="mt-3 border-t pt-2 font-mono text-[9px] opacity-70">
              {event.id_card_footer ?? ""}
            </p>
            <p className="mt-2 text-right font-mono text-[9px] opacity-70">
              {event.id_card_signatory_name ?? ""}
              {event.id_card_signatory_title ? ` · ${event.id_card_signatory_title}` : ""}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
      />
    </label>
  );
}

function Color({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <input
        name={name}
        type="color"
        defaultValue={defaultValue}
        className="mt-2 h-10 w-full cursor-pointer border-2 border-ink bg-bone"
      />
    </label>
  );
}
