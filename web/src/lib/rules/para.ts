/**
 * WAF 2025 Para-Armwrestling categories.
 *
 * The official chart groups athletes by impairment class first, then by
 * gender, age and weight. Class codes here match the WAF 2025 chart:
 *
 *   PID   (D / DW)    Physical Impairments — Sitting
 *   PIDH  (DA)        Physical w/ upper-limb Impairments — Sitting
 *   PIU   (U / UW)    Physical Impairments — Standing
 *   PIU-J (UJ / UJW)  Physical Impairments — Standing, Junior 23
 *   PIUH  (UA / UWA)  Physical w/ upper-limb Impairments — Standing
 *   PIUH-J(UJA)       Physical w/ upper-limb Impairments — Standing, Junior 23
 *   VI    (E / EW)    Visual Impairments — Standing
 *   VI-J  (EJ / EJW)  Visual Impairments — Standing, Junior 23
 *   HI    (H / HW)    Hearing Impairments — Standing
 *   HI-J  (HJ / HJW)  Hearing Impairments — Standing, Junior 23
 *   CPD   (DC)        Central Polly (cerebral palsy) — Sitting
 *   CPU   (UC)        Central Polly (cerebral palsy) — Standing
 *
 * Para events are single-arm: an athlete declares one competing arm and
 * enters one bracket per qualifying (class, weight) combination.
 */

import { WAF_PARA, type WafCategory } from "./waf-2025";

export type ParaPosture = "Standing" | "Seated";

export type ParaClassCode =
  | "PID" | "PIDH" | "PIU" | "PIU-J" | "PIUH" | "PIUH-J"
  | "VI"  | "VI-J" | "HI"  | "HI-J"  | "CPD"  | "CPU";

export type ParaClass = {
  code: ParaClassCode;
  label: string;
  posture: ParaPosture;
};

const CLASSES: readonly ParaClass[] = [
  { code: "PID",    label: "PID — Physical Impairments (Sitting)",                    posture: "Seated"   },
  { code: "PIDH",   label: "PIDH — Physical w/ upper-limb Impairments (Sitting)",     posture: "Seated"   },
  { code: "PIU",    label: "PIU — Physical Impairments (Standing)",                   posture: "Standing" },
  { code: "PIU-J",  label: "PIU Junior 23 — Physical Impairments (Standing)",         posture: "Standing" },
  { code: "PIUH",   label: "PIUH — Physical w/ upper-limb Impairments (Standing)",    posture: "Standing" },
  { code: "PIUH-J", label: "PIUH Junior 23 — Physical w/ upper-limb (Standing)",      posture: "Standing" },
  { code: "VI",     label: "VI — Visual Impairments (Standing)",                      posture: "Standing" },
  { code: "VI-J",   label: "VI Junior 23 — Visual Impairments (Standing)",            posture: "Standing" },
  { code: "HI",     label: "HI — Hearing Impairments (Standing)",                     posture: "Standing" },
  { code: "HI-J",   label: "HI Junior 23 — Hearing Impairments (Standing)",           posture: "Standing" },
  { code: "CPD",    label: "CPD — Central Polly Impairments (Sitting)",               posture: "Seated"   },
  { code: "CPU",    label: "CPU — Central Polly Impairments (Standing)",              posture: "Standing" },
];

export const PARA_CLASSES: readonly ParaClass[] = CLASSES;

export function paraPostureFor(code: ParaClassCode): ParaPosture {
  return CLASSES.find((c) => c.code === code)!.posture;
}

/** Map a WAF official category code (e.g. "D", "UJW") to its parent class. */
export function paraClassForWafCode(wafCode: string): ParaClassCode | null {
  const m: Record<string, ParaClassCode> = {
    D: "PID",   DW: "PID",
    DA: "PIDH",
    U: "PIU",   UW: "PIU",
    UJ: "PIU-J", UJW: "PIU-J",
    UA: "PIUH", UWA: "PIUH",
    UJA: "PIUH-J",
    E: "VI",    EW: "VI",
    EJ: "VI-J", EJW: "VI-J",
    H: "HI",    HW: "HI",
    HJ: "HI-J", HJW: "HI-J",
    DC: "CPD",
    UC: "CPU",
  };
  return m[wafCode] ?? null;
}

/** All WAF para category rows that belong to a given class (both genders,
 *  if both are contested). */
export function wafCategoriesForParaClass(code: ParaClassCode): WafCategory[] {
  return WAF_PARA.filter((c) => paraClassForWafCode(c.code) === code);
}
