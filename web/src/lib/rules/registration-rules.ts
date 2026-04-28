/**
 * Registration v2 domain rules.
 *
 * The old model encoded gender + para into a single `division` field.
 * This module is the canonical source of truth for the new shape:
 *
 *   gender ∈ {M, F}
 *   nonpara: optional set of WAF able-bodied class names + a hand (R/L/B)
 *   para:    optional set of WAF para codes + a hand (R/L/B)
 *
 * A registration is valid when at least one of the two participation
 * tracks is fully filled (≥1 class AND a hand). All eligibility / WAF
 * lookups come from {@link WAF_ABLE} / {@link WAF_PARA} — do not hardcode
 * weight tables anywhere else.
 */

import {
  WAF_ABLE,
  WAF_PARA,
  type Gender,
  type WafCategory,
} from "./waf-2025";
import { ageOnMatchDay } from "./age-bands";
export { ageOnDec31, ageOnMatchDay } from "./age-bands";

export type Hand = "R" | "L" | "B";

/** Distinct non-para WAF class names available to (gender, age), preserving
 *  chart order (Sub-Junior → Super Senior Grand Master). */
export function eligibleNonParaClasses(
  gender: Gender,
  age: number
): { className: string; classFull: string; minAge: number; maxAge: number | null }[] {
  const seen = new Set<string>();
  const out: { className: string; classFull: string; minAge: number; maxAge: number | null }[] = [];
  for (const c of WAF_ABLE) {
    if (c.gender !== gender) continue;
    if (age < c.minAge) continue;
    if (c.maxAge !== null && age > c.maxAge) continue;
    if (seen.has(c.className)) continue;
    seen.add(c.className);
    out.push({
      className: c.className,
      classFull: c.classFull,
      minAge: c.minAge,
      maxAge: c.maxAge,
    });
  }
  return out;
}

/** All WAF para categories (full rows) the athlete qualifies for. Each row
 *  is one bracket pool with its own weight grid; the athlete picks any
 *  subset to compete in. */
export function eligibleParaCategories(
  gender: Gender,
  age: number
): WafCategory[] {
  return WAF_PARA.filter(
    (c) =>
      c.gender === gender &&
      age >= c.minAge &&
      (c.maxAge === null || age <= c.maxAge)
  );
}

/** Returns the WAF row for a non-para className filtered by gender. */
export function nonParaCategory(
  className: string,
  gender: Gender
): WafCategory | undefined {
  return WAF_ABLE.find((c) => c.className === className && c.gender === gender);
}

/** Returns the WAF row for a para official code. */
export function paraCategory(code: string): WafCategory | undefined {
  return WAF_PARA.find((c) => c.code === code);
}

/** Derive a back-compat division string from the new shape. */
export function deriveDivision(
  gender: Gender,
  hasNonPara: boolean,
  hasPara: boolean
): "Men" | "Women" | "Para Men" | "Para Women" {
  // Prefer the able-bodied label when both tracks are entered — the
  // legacy column is informational only; entries carry the real division.
  if (hasNonPara) return gender === "F" ? "Women" : "Men";
  if (hasPara)    return gender === "F" ? "Para Women" : "Para Men";
  return gender === "F" ? "Women" : "Men";
}

export interface RegistrationInput {
  gender: Gender | null;
  dob: string | null;                 // YYYY-MM-DD
  declaredWeightKg: number | null;
  nonparaClasses: string[];           // className strings ("SENIOR", "MASTER", …)
  /** Per-class hand. Key = className. Each chosen class needs its own entry. */
  nonparaHands: Record<string, Hand>;
  includeSenior?: boolean;            // opt-in for under-19 athletes
  paraCodes: string[];                // WAF official codes ("U", "EW", …)
  paraHand: Hand | null;
}

export interface RegistrationValidation {
  ok: boolean;
  errors: string[];
  /** classes the form should restrict the user to, given gender + DOB. */
  allowedNonPara: string[];           // className strings
  allowedPara: string[];              // WAF codes
  /** filtered selections (out-of-eligibility entries dropped). */
  effectiveNonPara: string[];
  effectivePara: string[];
  /** Per-class hand restricted to effective non-para classes. */
  effectiveNonParaHands: Record<string, Hand>;
}

/**
 * Pure validator. Re-runnable on every keystroke; returns both the error
 * messages and the *effective* selections after dropping any classes the
 * athlete is no longer eligible for (e.g. they edited their DOB).
 */
export function validateRegistration(
  input: RegistrationInput,
  eventStartsAt: string | Date
): RegistrationValidation {
  const errors: string[] = [];

  if (!input.gender) errors.push("gender required");
  if (!input.dob || !/^\d{4}-\d{2}-\d{2}$/.test(input.dob)) {
    errors.push("date of birth required");
  }
  if (
    input.declaredWeightKg === null ||
    !Number.isFinite(input.declaredWeightKg) ||
    input.declaredWeightKg <= 0
  ) {
    errors.push("declared weight required");
  }

  let allowedNonPara: string[] = [];
  let allowedPara: string[] = [];
  if (input.gender && input.dob && /^\d{4}-\d{2}-\d{2}$/.test(input.dob)) {
    const age = ageOnMatchDay(input.dob, eventStartsAt);
    allowedNonPara = eligibleNonParaClasses(input.gender, age).map(
      (c) => c.className
    );
    // 16-18 athletes can opt into SENIOR (compete-up).
    if (
      input.includeSenior &&
      age >= 16 &&
      !allowedNonPara.includes("SENIOR")
    ) {
      allowedNonPara.push("SENIOR");
    }
    allowedPara = eligibleParaCategories(input.gender, age).map((c) => c.code);
  }

  const allowedNpSet = new Set(allowedNonPara);
  const allowedPaSet = new Set(allowedPara);
  const effectiveNonPara = input.nonparaClasses.filter((c) => allowedNpSet.has(c));
  const effectivePara = input.paraCodes.filter((c) => allowedPaSet.has(c));

  const npChose = effectiveNonPara.length > 0;
  const paChose = effectivePara.length > 0;

  const effectiveNonParaHands: Record<string, Hand> = {};
  for (const cls of effectiveNonPara) {
    const h = input.nonparaHands?.[cls];
    if (h) effectiveNonParaHands[cls] = h;
  }

  if (!npChose && !paChose) {
    errors.push("pick at least one age category or para class");
  }
  if (npChose && paChose) {
    errors.push("choose either non-para or para — not both");
  }
  if (effectivePara.length > 1) {
    errors.push("pick only one para class");
  }
  if (npChose) {
    const missing = effectiveNonPara.filter((c) => !effectiveNonParaHands[c]);
    if (missing.length > 0) {
      errors.push(`hand required for: ${missing.join(", ")}`);
    }
  }
  if (paChose && !input.paraHand) {
    errors.push("para hand required");
  }

  return {
    ok: errors.length === 0,
    errors,
    allowedNonPara,
    allowedPara,
    effectiveNonPara,
    effectivePara,
    effectiveNonParaHands,
  };
}
