"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { TN_DISTRICTS } from "@/lib/rules/tn-districts";
import {
  validateRegistration,
  eligibleNonParaClasses,
  eligibleParaCategories,
  ageOnMatchDay,
  type Hand,
} from "@/lib/rules/registration-rules";

interface EventShell {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  entry_fee_inr: number;
  payment_mode: "online_upi" | "offline" | "hybrid";
  primary_color: string;
  accent_color: string;
  text_on_primary: string;
  subtitle: string;
  org_name: string;
  poster_url: string | null;
  poster_kind: "image" | "pdf" | null;
}

interface AthleteIdentity {
  email: string;
  full_name: string;
}

type AffiliationKind = "District" | "Team";
type Gender = "M" | "F";

export interface RegisterPrefill {
  publicToken: string;
  full_name: string;
  initial: string;
  dob: string;
  gender: Gender | "";
  mobile: string;
  aadhaar_masked: string | null;
  affiliation_kind: AffiliationKind;
  district: string;
  team: string;
  declared_weight_kg: number | null;
  nonpara_classes: string[];
  nonpara_hands: Record<string, Hand>;
  para_codes: string[];
  para_hand: Hand | "";
}

export default function RegisterForm({
  event,
  athlete,
  mode = "create",
  prefill,
}: {
  event: EventShell;
  athlete: AthleteIdentity;
  mode?: "create" | "edit";
  prefill?: RegisterPrefill;
}) {
  const router = useRouter();
  const isEdit = mode === "edit" && !!prefill;

  const [fullName, setFullName] = useState(prefill?.full_name ?? athlete.full_name);
  const [initial, setInitial] = useState(prefill?.initial ?? "");
  const initialDob = prefill?.dob ?? "";
  const [dob, setDob] = useState(initialDob);
  const [dobYear, setDobYear] = useState(initialDob ? initialDob.slice(0, 4) : "");
  const [dobMonth, setDobMonth] = useState(
    initialDob ? String(Number(initialDob.slice(5, 7))) : ""
  );
  const [dobDay, setDobDay] = useState(
    initialDob ? String(Number(initialDob.slice(8, 10))) : ""
  );
  const [gender, setGender] = useState<Gender | "">(prefill?.gender ?? "");
  const [mobile, setMobile] = useState(prefill?.mobile ?? "");
  // Don't prefill aadhaar field with the masked version (XXXX XXXX 1234)
  // because it'd fail re-validation; leave it blank for re-entry if needed.
  const [aadhaar, setAadhaar] = useState("");

  const [affiliationKind, setAffiliationKind] = useState<AffiliationKind>(
    prefill?.affiliation_kind ?? "District"
  );
  const [district, setDistrict] = useState(prefill?.district ?? "");
  const [team, setTeam] = useState(prefill?.team ?? "");

  const [weightKg, setWeightKg] = useState<string>(
    prefill?.declared_weight_kg != null ? String(prefill.declared_weight_kg) : ""
  );

  // Bulk-desk-style primary + add-on model. SENIOR is treated as an
  // "add-on" only when it sits alongside another class; for adult athletes
  // whose only class is SENIOR, it IS the primary.
  const prefillNonpara = prefill?.nonpara_classes ?? [];
  const prefillNonparaHands = prefill?.nonpara_hands ?? {};
  const prefillHasNonSenior = prefillNonpara.some((c) => c !== "SENIOR");
  const prefillPrimary = prefillHasNonSenior
    ? prefillNonpara.find((c) => c !== "SENIOR") ?? ""
    : prefillNonpara[0] ?? "";
  const prefillAlsoSenior =
    prefillHasNonSenior && prefillNonpara.includes("SENIOR");

  const [primaryClassName, setPrimaryClassName] = useState<string>(prefillPrimary);
  const [primaryHand, setPrimaryHand] = useState<Hand | "">(
    (prefillNonparaHands[prefillPrimary] as Hand | undefined) ?? ""
  );
  const [alsoSenior, setAlsoSenior] = useState<boolean>(prefillAlsoSenior);
  const [seniorHand, setSeniorHand] = useState<Hand | "">(
    (prefillNonparaHands["SENIOR"] as Hand | undefined) ?? ""
  );

  const [paraOn, setParaOn] = useState((prefill?.para_codes ?? []).length > 0);
  const [paraCode, setParaCode] = useState<string>(
    (prefill?.para_codes ?? [])[0] ?? ""
  );
  const [paraHand, setParaHand] = useState<Hand | "">(prefill?.para_hand ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const eventYear = useMemo(
    () => new Date(event.starts_at).getUTCFullYear(),
    [event.starts_at]
  );
  const matchDayLabel = useMemo(
    () =>
      new Date(event.starts_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    [event.starts_at]
  );
  const age = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
    return ageOnMatchDay(dob, event.starts_at);
  }, [dob, event.starts_at]);

  // Sync three-part DOB selects -> ISO dob string.
  useEffect(() => {
    if (dobYear && dobMonth && dobDay) {
      const iso = `${dobYear}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`;
      // Reject impossible dates (Feb 30 etc.).
      const d = new Date(iso + "T00:00:00Z");
      const valid =
        d.getUTCFullYear() === Number(dobYear) &&
        d.getUTCMonth() + 1 === Number(dobMonth) &&
        d.getUTCDate() === Number(dobDay);
      setDob(valid ? iso : "");
    } else {
      setDob("");
    }
  }, [dobYear, dobMonth, dobDay]);

  // All non-para classes the athlete qualifies for, oldest band first.
  // Athlete picks one as their primary (matching the bulk desk's UX —
  // a SUB-JUNIOR may still want to enter as JUNIOR, etc.).
  const eligibleNonPara = useMemo(() => {
    if (!gender || age === null) return [];
    return [...eligibleNonParaClasses(gender, age)].sort(
      (a, b) => b.minAge - a.minAge
    );
  }, [gender, age]);

  // Senior add-on availability: 16+ and primary isn't already SENIOR.
  const seniorAddOnAvailable =
    age !== null &&
    age >= 16 &&
    !!primaryClassName &&
    primaryClassName !== "SENIOR" &&
    !paraOn;

  // Compete-up flag (16-22 opting into Senior). Server-side validator
  // requires this for any under-19 SENIOR pick.
  const includeSenior =
    age !== null &&
    age < 23 &&
    (primaryClassName === "SENIOR" || (alsoSenior && seniorAddOnAvailable));

  // Mutually-exclusive track switch.
  function setTrackPara(on: boolean) {
    setParaOn(on);
    if (on) {
      setPrimaryClassName("");
      setPrimaryHand("");
      setAlsoSenior(false);
      setSeniorHand("");
    } else {
      setParaCode("");
      setParaHand("");
    }
  }

  // Default primary to oldest eligible class when eligibility changes.
  // Skip the very first run in edit mode so we keep the prefilled
  // selection; a real change to gender/dob will still re-default.
  const skipResetRef = useRef(isEdit);
  useEffect(() => {
    if (skipResetRef.current) {
      skipResetRef.current = false;
      return;
    }
    if (paraOn) return;
    const allowed = eligibleNonPara.map((c) => c.className);
    if (primaryClassName && allowed.includes(primaryClassName)) return;
    const next = allowed[0] ?? "";
    setPrimaryClassName(next);
    if (next !== primaryClassName) {
      setPrimaryHand("");
      setAlsoSenior(false);
      setSeniorHand("");
    }
  }, [eligibleNonPara, paraOn, primaryClassName]);

  // Drop the senior add-on if it stops being available.
  useEffect(() => {
    if (!seniorAddOnAvailable && (alsoSenior || seniorHand)) {
      setAlsoSenior(false);
      setSeniorHand("");
    }
  }, [seniorAddOnAvailable, alsoSenior, seniorHand]);

  // Build the array shape the validator + API expect.
  const nonparaClasses = useMemo(() => {
    if (paraOn || !primaryClassName) return [] as string[];
    return alsoSenior && primaryClassName !== "SENIOR"
      ? [primaryClassName, "SENIOR"]
      : [primaryClassName];
  }, [paraOn, primaryClassName, alsoSenior]);

  const nonparaHands = useMemo(() => {
    const h: Record<string, Hand> = {};
    if (paraOn || !primaryClassName) return h;
    if (primaryHand) h[primaryClassName] = primaryHand;
    if (alsoSenior && primaryClassName !== "SENIOR" && seniorHand) {
      h["SENIOR"] = seniorHand;
    }
    return h;
  }, [paraOn, primaryClassName, primaryHand, alsoSenior, seniorHand]);

  const paraOptions = useMemo(() => {
    if (!gender || age === null) return [];
    return eligibleParaCategories(gender, age);
  }, [gender, age]);

  const validation = useMemo(
    () =>
      validateRegistration(
        {
          gender: gender || null,
          dob: dob || null,
          declaredWeightKg: weightKg ? Number(weightKg) : null,
          nonparaClasses: paraOn ? [] : nonparaClasses,
          nonparaHands: paraOn ? {} : nonparaHands,
          includeSenior: paraOn ? false : includeSenior,
          paraCodes: paraOn && paraCode ? [paraCode] : [],
          paraHand: paraOn ? paraHand || null : null,
        },
        event.starts_at
      ),
    [
      gender,
      dob,
      weightKg,
      nonparaClasses,
      nonparaHands,
      includeSenior,
      paraOn,
      paraCode,
      paraHand,
      event.starts_at,
    ]
  );

  function toggleAlsoSenior(on: boolean) {
    setAlsoSenior(on);
    if (!on) setSeniorHand("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShowErrors(true);
    if (!validation.ok) {
      setError(validation.errors.join(" \u00B7 "));
      return;
    }
    setSubmitting(true);

    try {
      const body = {
        event_slug: event.slug,
        full_name: fullName,
        initial: initial || undefined,
        dob,
        gender,
        affiliation_kind: affiliationKind,
        district: affiliationKind === "District" ? district : undefined,
        team: affiliationKind === "Team" ? team : undefined,
        mobile,
        aadhaar: aadhaar || undefined,
        declared_weight_kg: Number(weightKg),
        nonpara_classes: validation.effectiveNonPara,
        nonpara_hands: validation.effectiveNonParaHands,
        include_senior: includeSenior,
        para_codes: validation.effectivePara,
        para_hand:
          validation.effectivePara.length > 0
            ? paraHand || undefined
            : undefined,
      };

      const url = isEdit
        ? `/api/register/${prefill!.publicToken}`
        : "/api/register";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.already && json.public_token) {
        router.push(`/e/${event.slug}/registered/${json.public_token}`);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "registration failed");
      const token = isEdit ? prefill!.publicToken : json.public_token;
      router.push(`/e/${event.slug}/registered/${token}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main
      className="min-h-screen"
      style={
        {
          "--event-primary": event.primary_color,
          "--event-accent": event.accent_color,
          "--event-on-primary": event.text_on_primary,
        } as React.CSSProperties
      }
    >
      <header
        className="border-b border-black/10 px-4 py-4 sm:px-6 sm:py-5"
        style={{
          background: event.primary_color,
          color: event.text_on_primary,
        }}
      >
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-3">
          <a
            href={`/e/${event.slug}`}
            className="min-w-0 truncate text-xs italic opacity-70"
          >
            ← {event.name}
          </a>
          <span
            className="shrink-0 text-[10px] uppercase tracking-[0.3em]"
            style={{ color: event.accent_color }}
          >
            {isEdit ? "edit" : "register"}
          </span>
        </div>
      </header>

      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:space-y-10 sm:px-6 sm:py-10"
      >
        <div>
          <h1 className="font-display text-3xl font-black leading-tight sm:text-4xl">
            {isEdit ? "Update your registration." : "Enter the pit."}
          </h1>
          <p className="mt-2 text-sm text-ink/60">
            {isEdit
              ? "Fix anything below and save. You can edit until your payment is verified."
              : event.entry_fee_inr <= 0
                ? "Three minutes. No entry fee. One registration per athlete per event."
                : event.payment_mode === "offline"
                  ? `Three minutes. \u20B9${event.entry_fee_inr} entry fee — hand to your district secretary or pay at the venue counter. One registration per athlete per event.`
                  : event.payment_mode === "hybrid"
                    ? `Three minutes. \u20B9${event.entry_fee_inr} entry fee — pay via UPI after you submit, or hand to your district secretary. One registration per athlete per event.`
                    : `Three minutes. \u20B9${event.entry_fee_inr} entry fee via UPI after you submit. One registration per athlete per event.`}
          </p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
            Signed in as <span className="text-ink">{athlete.email}</span>
          </p>
        </div>

        <Section title="Who you are">
          <div className="grid grid-cols-[5rem_1fr] gap-3 sm:grid-cols-[1fr_4fr] sm:gap-4">
            <Field label="Initial" hint="S.">
              <input
                value={initial}
                onChange={(e) => setInitial(e.target.value.toUpperCase().slice(0, 3))}
                className="input"
                placeholder="A"
              />
            </Field>
            <Field label="Full name" required>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input"
                required
                placeholder="Arjun Selvam"
              />
            </Field>
          </div>

          <Field label="Gender" required>
            <div className="grid grid-cols-2 gap-2">
              {(["M", "F"] as Gender[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
                    gender === g
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/20 hover:border-ink"
                  }`}
                >
                  {g === "M" ? "Male" : "Female"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Date of birth" required hint="Used for age category">
            <DobPicker
              year={dobYear}
              month={dobMonth}
              day={dobDay}
              onYear={setDobYear}
              onMonth={setDobMonth}
              onDay={setDobDay}
              eventYear={eventYear}
            />
            {age !== null && (
              <p className="mt-1 text-xs text-ink/50">
                Age on match day ({matchDayLabel}): <strong>{age}</strong>
              </p>
            )}
          </Field>

          <Field label="Mobile (10 digits)" required>
            <input
              inputMode="numeric"
              pattern="\d{10}"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
              className="input"
              required
              placeholder="9876500000"
            />
          </Field>

          <Field label="Aadhaar" hint="Optional. Only the last 4 digits are stored.">
            <input
              inputMode="numeric"
              maxLength={14}
              value={aadhaar}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^\d\s-]/g, "");
                const digits = cleaned.replace(/\D/g, "");
                if (digits.length > 12) {
                  setAadhaar(digits.slice(0, 12));
                } else {
                  setAadhaar(cleaned);
                }
              }}
              className="input"
              placeholder="XXXX XXXX 1234"
            />
          </Field>
        </Section>

        <Section title="Represent">
          <Field label="Register as" required>
            <div className="grid grid-cols-2 gap-2">
              {(["District", "Team"] as AffiliationKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAffiliationKind(k)}
                  className={`border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
                    affiliationKind === k
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/20 hover:border-ink"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </Field>

          {affiliationKind === "District" ? (
            <Field label="District" required>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="input"
                required
              >
                <option value="">Select district…</option>
                {TN_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Team name" required>
              <input
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                className="input"
                required
                placeholder="Chennai Arm Wrestling Club"
              />
            </Field>
          )}
        </Section>

        <Section title="Weight">
          <Field
            label="Declared weight (kg)"
            required
            hint="Final class is decided at on-site weigh-in."
          >
            <input
              type="number"
              step="0.1"
              min="20"
              max="250"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              className="input"
              required
              placeholder="78.5"
            />
          </Field>
        </Section>

        <Section title="Competition track">
          <Field label="Track" required hint="Athletes compete in either the able-bodied or para track — not both.">
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: false, label: "Non-para" },
                { v: true, label: "Para" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setTrackPara(o.v)}
                  className={`border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
                    paraOn === o.v
                      ? "border-ink bg-ink text-bone"
                      : "border-ink/20 hover:border-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        {!paraOn && (
        <Section title="Age category">
          {!gender || age === null ? (
            <p className="text-sm text-ink/50">
              Pick your gender and date of birth above to see your category.
            </p>
          ) : eligibleNonPara.length === 0 ? (
            <p className="text-sm text-ink/50">
              No able-bodied category for this age/gender.
            </p>
          ) : (
            <>
              <Field
                label="Your age class"
                required
                hint="Defaults to your natural band — change to compete up."
              >
                <select
                  value={primaryClassName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPrimaryClassName(next);
                    setPrimaryHand("");
                    if (next === "SENIOR") {
                      setAlsoSenior(false);
                      setSeniorHand("");
                    }
                  }}
                  className="input"
                  required
                >
                  <option value="">Select class…</option>
                  {eligibleNonPara.map((c) => (
                    <option key={c.className} value={c.className}>
                      {c.classFull} ({c.minAge}
                      {c.maxAge === null ? "+" : `\u2013${c.maxAge}`})
                    </option>
                  ))}
                </select>
              </Field>

              {primaryClassName && (
                <Field
                  label={`Hand — ${
                    eligibleNonPara.find((c) => c.className === primaryClassName)
                      ?.classFull ?? primaryClassName
                  }`}
                  required
                >
                  <HandChooser value={primaryHand} onChange={setPrimaryHand} />
                </Field>
              )}

              {seniorAddOnAvailable && (
                <Field
                  label="Also compete in Senior (optional)"
                  hint="Compete-up into the open Senior bracket"
                >
                  <label
                    className={`flex cursor-pointer items-start gap-3 border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
                      alsoSenior
                        ? "border-ink bg-ink text-bone"
                        : "border-ink/20 hover:border-ink"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={alsoSenior}
                      onChange={(e) => toggleAlsoSenior(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="leading-tight">
                      Senior
                      <span className="ml-1 opacity-60 normal-case">(19+)</span>
                    </span>
                  </label>
                </Field>
              )}

              {alsoSenior && (
                <Field label="Hand — Senior" required>
                  <HandChooser value={seniorHand} onChange={setSeniorHand} />
                </Field>
              )}
            </>
          )}
        </Section>
        )}

        {paraOn && (
        <Section title="Para-armwrestling">
              {!gender || age === null ? (
                <p className="text-sm text-ink/50">
                  Pick gender and date of birth above to see eligible para classes.
                </p>
              ) : paraOptions.length === 0 ? (
                <p className="text-sm text-ink/50">
                  No para category available for this age/gender.
                </p>
              ) : (
                <>
                  <Field
                    label="Para class"
                    required
                    hint="Pick the one classification you compete in"
                  >
                    <div className="grid grid-cols-1 gap-2">
                      {paraOptions.map((c) => {
                        const checked = paraCode === c.code;
                        return (
                          <label
                            key={c.code}
                            className={`flex cursor-pointer items-start gap-3 border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
                              checked
                                ? "border-ink bg-ink text-bone"
                                : "border-ink/20 hover:border-ink"
                            }`}
                          >
                            <input
                              type="radio"
                              name="para_code"
                              checked={checked}
                              onChange={() => setParaCode(c.code)}
                              className="mt-0.5"
                            />
                            <span className="leading-tight">
                              <span className="font-mono opacity-70">{c.code}</span>{" "}
                              · {c.classFull}
                              <span className="ml-1 opacity-60 normal-case">
                                ({c.posture}, {c.minAge}
                                {c.maxAge === null ? "+" : `\u2013${c.maxAge}`})
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </Field>

                  {paraCode && (
                    <Field label="Hand (para)" required hint="Para is single-arm">
                      <HandChooser value={paraHand} onChange={setParaHand} />
                    </Field>
                  )}
                </>
              )}
        </Section>
        )}

        <Section title="ID photo">
          <p className="text-xs text-ink/50">
            Photo will be captured at on-site weigh-in.
          </p>
        </Section>

        {(error || (showErrors && !validation.ok)) && (
          <div className="border border-rust/40 bg-rust/5 p-4 text-sm text-rust">
            {error ?? validation.errors.join(" \u00B7 ")}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="sticky bottom-3 z-10 flex w-full items-center justify-center gap-3 bg-ink px-4 py-4 font-display text-base font-bold uppercase tracking-[0.15em] text-bone shadow-lg shadow-ink/20 disabled:cursor-wait disabled:opacity-80 sm:static sm:px-6 sm:py-5 sm:text-lg sm:tracking-[0.2em] sm:shadow-none"
          style={{ background: event.primary_color, color: event.text_on_primary }}
        >
          {submitting && (
            <span
              aria-hidden
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {submitting
            ? isEdit
              ? "Saving\u2026"
              : "Submitting\u2026"
            : isEdit
              ? "Save changes"
              : event.entry_fee_inr <= 0
                ? "Submit registration"
                : event.payment_mode === "offline"
                  ? `Submit · pay \u20B9${event.entry_fee_inr} at counter`
                  : `Submit & pay \u20B9${event.entry_fee_inr}`}
        </button>

        <p className="text-center text-xs text-ink/40">
          {event.org_name} · by submitting you agree to on-site weigh-in and
          rule compliance.
        </p>
      </form>

      {submitting && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm text-bone"
        >
          <span
            aria-hidden
            className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-bone border-t-transparent"
          />
          <p className="font-display text-sm uppercase tracking-[0.3em]">
            {isEdit ? "Saving changes\u2026" : "Saving your registration\u2026"}
          </p>
          <p className="text-xs opacity-70">Don&rsquo;t close this tab.</p>
        </div>
      )}

      <style jsx global>{`
        .input {
          display: block;
          width: 100%;
          border: 1px solid rgb(from currentColor r g b / 0.2);
          background: white;
          padding: 0.75rem 0.9rem;
          font-size: 16px;
          line-height: 1.35;
          outline: none;
          transition: border-color 120ms;
          -webkit-appearance: none;
          appearance: none;
          border-radius: 0;
          min-height: 44px;
        }
        @media (min-width: 640px) {
          .input {
            font-size: 1rem;
          }
        }
        .input:focus {
          border-color: var(--event-primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--event-primary) 20%, transparent);
        }
      `}</style>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-5 border-t border-ink/10 pt-8">
      <legend className="font-display text-xs uppercase tracking-[0.25em] text-ink/50">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm font-medium">
        <span>
          {label}
          {required && <span className="ml-1 text-rust">*</span>}
        </span>
        {hint && <span className="text-xs text-ink/40">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function HandChooser({
  value,
  onChange,
}: {
  value: Hand | "";
  onChange: (v: Hand) => void;
}) {
  const options: { v: Hand; label: string }[] = [
    { v: "R", label: "Right" },
    { v: "L", label: "Left" },
    { v: "B", label: "Both" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`border px-3 py-3 text-xs font-semibold uppercase tracking-wider ${
            value === o.v
              ? "border-ink bg-ink text-bone"
              : "border-ink/20 hover:border-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DobPicker({
  year,
  month,
  day,
  onYear,
  onMonth,
  onDay,
  eventYear,
}: {
  year: string;
  month: string;
  day: string;
  onYear: (v: string) => void;
  onMonth: (v: string) => void;
  onDay: (v: string) => void;
  eventYear: number;
}) {
  // Reasonable competing-age window: 8 to 90 years old at event time.
  const maxYear = eventYear - 8;
  const minYear = eventYear - 90;
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // Days that actually exist for the chosen year/month.
  const daysInMonth = (() => {
    const y = Number(year);
    const m = Number(month);
    if (!y || !m) return 31;
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  })();
  const days: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div className="grid grid-cols-3 gap-2">
      <select
        className="input"
        value={day}
        onChange={(e) => onDay(e.target.value)}
        required
        aria-label="Day"
      >
        <option value="">Day</option>
        {days.map((d) => (
          <option key={d} value={String(d)}>
            {d}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={month}
        onChange={(e) => onMonth(e.target.value)}
        required
        aria-label="Month"
      >
        <option value="">Month</option>
        {months.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={year}
        onChange={(e) => onYear(e.target.value)}
        required
        aria-label="Year"
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
