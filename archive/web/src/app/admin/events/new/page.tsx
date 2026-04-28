import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const sess = await getSession();
  if (!isSuperAdmin(sess.role)) redirect("/admin/events");
  const admin = createAdminClient();
  const { data: rules } = await admin.from("rule_profiles").select("id, code, name").order("code");
  return (
    <div className="space-y-6">
      <Link href="/admin/events" className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink">
        ← Events
      </Link>
      <h1 className="font-display text-5xl tracking-tight2">New event</h1>

      <form action={createEvent} className="max-w-[760px] space-y-5 border-2 border-ink p-6">
        <Field name="name" label="Event name" required placeholder="TN State Arm Wrestling Championship 2027" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field name="venue_city" label="Venue city" />
          <Field name="venue_state" label="Venue state" defaultValue="Tamil Nadu" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field name="starts_at" label="Starts at" type="datetime-local" required />
          <Field name="entry_fee_inr" label="Entry fee (₹)" type="number" defaultValue="500" />
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Rule profile</span>
          <select
            name="rule_profile_id"
            defaultValue={(rules ?? []).find((r) => r.code === "IAFF-2024")?.id ?? ""}
            className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
          >
            <option value="">— none —</option>
            {(rules ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.code} · {r.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field name="upi_id" label="UPI ID (e.g. tnawa@okhdfc)" />
          <Field name="upi_payee_name" label="UPI payee name" />
        </div>
        <p className="font-mono text-xs text-ink/60">
          You'll be taken to the edit screen next so you can fill in the rest of the details.
        </p>
        <button
          type="submit"
          className="w-full border-2 border-ink bg-ink py-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-bone hover:bg-blood hover:border-blood"
        >
          Create event →
        </button>
      </form>
    </div>
  );
}

function Field({
  name, label, type = "text", required, placeholder, defaultValue,
}: {
  name: string; label: string; type?: string; required?: boolean;
  placeholder?: string; defaultValue?: string;
}) {
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
