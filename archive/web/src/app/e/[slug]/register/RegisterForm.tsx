"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ParaClassOpt = { code: string; label: string; posture: "Standing" | "Seated" };

export default function RegisterForm({
  eventSlug,
  districts,
  paraClasses,
}: {
  eventSlug: string;
  districts: readonly string[];
  paraClasses: ParaClassOpt[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [division, setDivision] = useState<"Men" | "Women" | "Para Men" | "Para Women">("Men");
  const [affiliation, setAffiliation] = useState<"District" | "Team">("District");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isPara = division === "Para Men" || division === "Para Women";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("event_slug", eventSlug);
    form.set("is_para", String(isPara));
    if (!fileRef.current?.files?.[0]) {
      setError("Please attach a passport-style photo");
      return;
    }
    form.set("photo", fileRef.current.files[0]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/registrations", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Registration failed");
        setSubmitting(false);
        return;
      }
      router.push(json.next as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-[760px] space-y-6 px-6 py-8">
      {error && (
        <div className="border-2 border-ink bg-blood/10 p-4 font-mono text-sm">
          {error}
        </div>
      )}

      <Section title="Athlete">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[80px_1fr]">
          <Field name="initial" label="Initial" placeholder="K" required maxLength={5} />
          <Field name="full_name" label="Full name" placeholder="MURUGAN" required />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field name="dob" label="Date of birth" type="date" required />
          <Select name="gender" label="Gender" options={[{ v: "M", l: "Male" }, { v: "F", l: "Female" }]} />
          <Select
            name="division"
            label="Division"
            value={division}
            onChange={(v) => setDivision(v as typeof division)}
            options={[
              { v: "Men", l: "Men" },
              { v: "Women", l: "Women" },
              { v: "Para Men", l: "Para Men" },
              { v: "Para Women", l: "Para Women" },
            ]}
          />
        </div>
        <Field
          name="declared_weight_kg"
          label="Declared body weight (kg)"
          type="number"
          step="0.1"
          min="20"
          max="250"
          required
        />
      </Section>

      {isPara && (
        <Section title="Para classification">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              name="para_class"
              label="Para class"
              options={paraClasses.map((p) => ({ v: p.code, l: `${p.code} · ${p.label}` }))}
              required
            />
            <Select
              name="para_posture"
              label="Posture"
              options={[
                { v: "Standing", l: "Standing" },
                { v: "Seated", l: "Seated" },
              ]}
            />
          </div>
        </Section>
      )}

      <Section title="Affiliation">
        <Select
          name="affiliation_kind"
          label="Type"
          value={affiliation}
          onChange={(v) => setAffiliation(v as typeof affiliation)}
          options={[
            { v: "District", l: "District" },
            { v: "Team", l: "Team / Club" },
          ]}
        />
        {affiliation === "District" ? (
          <Select
            name="district"
            label="District (Tamil Nadu)"
            options={districts.map((d) => ({ v: d, l: d }))}
            required
          />
        ) : (
          <Field name="team" label="Team / club name" required />
        )}
      </Section>

      <Section title="Hand">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select
            name="senior_hand"
            label="Senior hand"
            options={[
              { v: "", l: "—" },
              { v: "R", l: "Right" },
              { v: "L", l: "Left" },
              { v: "B", l: "Both" },
            ]}
          />
          <Select
            name="youth_hand"
            label="Youth/Junior hand"
            options={[
              { v: "", l: "—" },
              { v: "R", l: "Right" },
              { v: "L", l: "Left" },
              { v: "B", l: "Both" },
            ]}
          />
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field name="mobile" label="Mobile" type="tel" placeholder="+9198..." required />
          <Field name="aadhaar_masked" label="Aadhaar (last 4)" placeholder="XXXX-XXXX-1234" />
        </div>
      </Section>

      <Section title="Photo">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
            Passport-style photo (JPG/PNG, max 15 MB)
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPhotoPreview(f ? URL.createObjectURL(f) : null);
            }}
            className="mt-2 block w-full font-mono text-xs"
          />
        </label>
        {photoPreview && (
          <div className="mt-2 inline-block border-2 border-ink p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="Preview" className="h-40 w-32 object-cover" />
          </div>
        )}
      </Section>

      <button
        type="submit"
        disabled={submitting}
        className="w-full border-2 border-ink py-4 font-mono text-xs font-bold uppercase tracking-[0.3em] disabled:opacity-50"
        style={{
          backgroundColor: "var(--event-primary)",
          color: "var(--event-on-primary)",
        }}
      >
        {submitting ? "Submitting…" : "Register & continue to payment →"}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-2 border-ink p-5">
      <legend className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
  maxLength,
  step,
  min,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        step={step}
        min={min}
        max={max}
        className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
      />
    </label>
  );
}

function Select({
  name,
  label,
  options,
  value,
  onChange,
  required,
}: {
  name: string;
  label: string;
  options: { v: string; l: string }[];
  value?: string;
  onChange?: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{label}</span>
      <select
        name={name}
        required={required}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-2 w-full border-2 border-ink bg-bone px-3 py-3 font-mono text-sm focus:bg-volt focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}
