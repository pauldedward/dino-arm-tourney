import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { updateEvent } from "../../actions";

export const dynamic = "force-dynamic";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local expects "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) redirect(`/admin/events/${id}`);
  const admin = createAdminClient();
  const [{ data: event }, { data: rules }] = await Promise.all([
    admin.from("events").select("*").eq("id", id).maybeSingle(),
    admin.from("rule_profiles").select("id, code, name").order("code"),
  ]);
  if (!event) notFound();

  async function save(formData: FormData) {
    "use server";
    await updateEvent(id, formData);
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/events/${id}`}
        className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink"
      >
        ← {event.name}
      </Link>
      <h1 className="font-display text-5xl tracking-tight2">Edit event</h1>

      <form action={save} className="space-y-8 border-2 border-ink p-6 max-w-[960px]">
        <Section title="Basics">
          <Field name="name" label="Event name" required defaultValue={event.name} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field name="slug" label="Slug" defaultValue={event.slug} placeholder="e.g. tn-state-2026" />
            <SelectField
              name="status"
              label="Status"
              defaultValue={event.status ?? "draft"}
              options={["draft", "open", "live", "completed", "archived"]}
            />
          </div>
          <Field
            name="description"
            label="Description"
            type="textarea"
            defaultValue={event.description ?? ""}
          />
        </Section>

        <Section title="Venue">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field name="venue_name" label="Venue name" defaultValue={event.venue_name ?? ""} />
            <Field name="venue_city" label="City" defaultValue={event.venue_city ?? ""} />
            <Field name="venue_state" label="State" defaultValue={event.venue_state ?? ""} />
          </div>
        </Section>

        <Section title="Schedule">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              name="starts_at"
              label="Starts at"
              type="datetime-local"
              required
              defaultValue={toLocalInput(event.starts_at)}
            />
            <Field
              name="ends_at"
              label="Ends at"
              type="datetime-local"
              defaultValue={toLocalInput(event.ends_at)}
            />
            <Field
              name="registration_opens_at"
              label="Registration opens at"
              type="datetime-local"
              defaultValue={toLocalInput(event.registration_opens_at)}
            />
            <Field
              name="registration_closes_at"
              label="Registration closes at"
              type="datetime-local"
              defaultValue={toLocalInput(event.registration_closes_at)}
            />
            <Field
              name="weigh_in_starts_at"
              label="Weigh-in starts at"
              type="datetime-local"
              defaultValue={toLocalInput(event.weigh_in_starts_at)}
            />
            <Field
              name="weigh_in_ends_at"
              label="Weigh-in ends at"
              type="datetime-local"
              defaultValue={toLocalInput(event.weigh_in_ends_at)}
            />
          </div>
        </Section>

        <Section title="Rules">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Rule profile</span>
              <select
                name="rule_profile_id"
                defaultValue={event.rule_profile_id ?? ""}
                className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
              >
                <option value="">— none —</option>
                {(rules ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.code} · {r.name}</option>
                ))}
              </select>
            </label>
            <SelectField
              name="hand"
              label="Hand"
              defaultValue={event.hand ?? "both"}
              options={["right", "left", "both"]}
            />
          </div>
        </Section>

        <Section title="Money">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              name="entry_fee_inr"
              label="Entry fee (₹)"
              type="number"
              defaultValue={String(event.entry_fee_inr ?? 0)}
            />
            <Field
              name="entry_fee_default_inr"
              label="Default fee (₹)"
              type="number"
              defaultValue={String(event.entry_fee_default_inr ?? event.entry_fee_inr ?? 0)}
            />
            <Field
              name="prize_pool_inr"
              label="Prize pool (₹)"
              type="number"
              defaultValue={String(event.prize_pool_inr ?? 0)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SelectField
              name="payment_provider"
              label="Payment provider"
              defaultValue={event.payment_provider ?? "manual_upi"}
              options={["manual_upi", "razorpay", "none"]}
            />
            <Field name="upi_id" label="UPI ID" defaultValue={event.upi_id ?? ""} />
            <Field name="upi_payee_name" label="UPI payee name" defaultValue={event.upi_payee_name ?? ""} />
          </div>
        </Section>

        <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink pt-5">
          <button
            type="submit"
            className="border-2 border-ink bg-ink px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
          >
            Save changes
          </button>
          <Link
            href={`/admin/events/${id}`}
            className="border-2 border-ink bg-bone px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] hover:bg-volt"
          >
            Cancel
          </Link>
          <Link
            href={`/admin/events/${id}/branding`}
            className="ml-auto font-mono text-xs underline hover:text-blood"
          >
            Edit branding & ID card →
          </Link>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  name, label, type = "text", required, placeholder, defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  if (type === "textarea") {
    return (
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
        <textarea
          name={name}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          rows={3}
          className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
        />
      </label>
    );
  }
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
      />
    </label>
  );
}

function SelectField({
  name, label, defaultValue, options,
}: {
  name: string; label: string; defaultValue: string; options: string[];
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
