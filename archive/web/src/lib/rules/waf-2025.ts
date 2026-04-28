/**
 * WAF 2025 Categories — canonical reference.
 *
 * Source: official 2025 WAF charts (able-bodied + para-armwrestling).
 * Each row encodes (class, age range, gender code, weight buckets in kg).
 * `upperKg = null` means open weight bucket ("+N kg" or OPEN).
 *
 * This file is the single source of truth. Other helpers (`weight-classes`,
 * `para`) derive their data from here.
 */

export type Gender = "M" | "F";
export type Posture = "Standing" | "Sitting";

export type WafBucket = {
  code: string;        // e.g. "M-80", "K-70+", "U-90+"
  label: string;       // human-friendly, e.g. "−80 kg", "+90 kg", "OPEN"
  upperKg: number | null;
};

export type WafCategory = {
  /** Official WAF code: K, KW, J, JW, Y, YW, M, F, V, VW, GV, GVW, SGV, SPV,
   *  D, DW, DA, U, UW, UJ, UJW, UA, UWA, UJA, E, EW, EJ, EJW, H, HW, HJ, HJW,
   *  DC, UC. */
  code: string;
  className: string;   // e.g. "SENIOR", "PIU Standing"
  classFull: string;   // e.g. "Senior", "Physical Impairments Standing"
  gender: Gender;
  minAge: number;
  maxAge: number | null;
  isPara: boolean;
  posture: Posture;    // Standing for able-bodied & most para; Sitting for PID/PIDH/CPD
  buckets: WafBucket[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function bks(prefix: string, caps: Array<number | "open">, openAfter?: number): WafBucket[] {
  return caps.map((c) => {
    if (c === "open") {
      const after = openAfter!;
      return { code: `${prefix}-${after}+`, label: `+${after} kg`, upperKg: null };
    }
    return { code: `${prefix}-${c}`, label: `−${c} kg`, upperKg: c };
  });
}

// ─── Able-bodied (2025 WAF Armwrestling Categories chart) ─────────────────
export const WAF_ABLE: WafCategory[] = [
  // SUB-JUNIOR 15 (14–15)
  {
    code: "K", className: "SUB-JUNIOR 15", classFull: "Sub-Junior 15",
    gender: "M", minAge: 14, maxAge: 15, isPara: false, posture: "Standing",
    buckets: bks("K", [45, 50, 55, 60, 65, 70, "open"], 70),
  },
  {
    code: "KW", className: "SUB-JUNIOR 15", classFull: "Sub-Junior 15",
    gender: "F", minAge: 14, maxAge: 15, isPara: false, posture: "Standing",
    buckets: bks("KW", [40, 45, 50, 55, 60, 70, "open"], 70),
  },
  // JUNIOR 18 (16–18)
  {
    code: "J", className: "JUNIOR 18", classFull: "Junior 18",
    gender: "M", minAge: 16, maxAge: 18, isPara: false, posture: "Standing",
    buckets: bks("J", [50, 55, 60, 65, 70, 75, 80, 90, "open"], 90),
  },
  {
    code: "JW", className: "JUNIOR 18", classFull: "Junior 18",
    gender: "F", minAge: 16, maxAge: 18, isPara: false, posture: "Standing",
    buckets: bks("JW", [45, 50, 55, 60, 65, 70, "open"], 70),
  },
  // YOUTH 23 (19–23)
  {
    code: "Y", className: "YOUTH 23", classFull: "Youth 23",
    gender: "M", minAge: 19, maxAge: 23, isPara: false, posture: "Standing",
    buckets: bks("Y", [55, 60, 65, 70, 75, 80, 85, 90, 100, 110, "open"], 110),
  },
  {
    code: "YW", className: "YOUTH 23", classFull: "Youth 23",
    gender: "F", minAge: 19, maxAge: 23, isPara: false, posture: "Standing",
    buckets: bks("YW", [50, 55, 60, 65, 70, 80, 90, "open"], 90),
  },
  // SENIOR (ALL)
  {
    code: "M", className: "SENIOR", classFull: "Senior",
    gender: "M", minAge: 19, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("M", [55, 60, 65, 70, 75, 80, 85, 90, 100, 110, "open"], 110),
  },
  {
    code: "F", className: "SENIOR", classFull: "Senior",
    gender: "F", minAge: 19, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("F", [50, 55, 60, 65, 70, 80, 90, "open"], 90),
  },
  // MASTER (40+)
  {
    code: "V", className: "MASTER", classFull: "Master",
    gender: "M", minAge: 40, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("V", [60, 70, 80, 90, 100, 110, "open"], 110),
  },
  {
    code: "VW", className: "MASTER", classFull: "Master",
    gender: "F", minAge: 40, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("VW", [60, 70, 80, "open"], 80),
  },
  // GRAND MASTER (50+)
  {
    code: "GV", className: "GRAND MASTER", classFull: "Grand Master",
    gender: "M", minAge: 50, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("GV", [70, 80, 90, 100, "open"], 100),
  },
  {
    code: "GVW", className: "GRAND MASTER", classFull: "Grand Master",
    gender: "F", minAge: 50, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("GVW", [60, 70, 80, "open"], 80),
  },
  // SENIOR GRAND MASTER (60+) — male only on chart
  {
    code: "SGV", className: "SENIOR GRAND MASTER", classFull: "Senior Grand Master",
    gender: "M", minAge: 60, maxAge: null, isPara: false, posture: "Standing",
    buckets: bks("SGV", [70, 80, 90, 100, "open"], 100),
  },
  // SUPER SENIOR GRAND MASTER (70+) — male only, single OPEN bucket
  {
    code: "SPV", className: "SUPER SENIOR GRAND MASTER", classFull: "Super Senior Grand Master",
    gender: "M", minAge: 70, maxAge: null, isPara: false, posture: "Standing",
    buckets: [{ code: "SPV-OPEN", label: "OPEN", upperKg: null }],
  },
];

// ─── Para (2025 WAF Para-Armwrestling Categories chart) ───────────────────
export const WAF_PARA: WafCategory[] = [
  // PID Sitting — Physical Impairments Sitting (ALL)
  {
    code: "D", className: "PID Sitting", classFull: "Physical Impairments Sitting",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Sitting",
    buckets: bks("D", [55, 65, 75, 100, "open"], 100),
  },
  {
    code: "DW", className: "PID Sitting", classFull: "Physical Impairments Sitting",
    gender: "F", minAge: 14, maxAge: null, isPara: true, posture: "Sitting",
    buckets: bks("DW", [55, 65, "open"], 65),
  },
  // PIDH Sitting — Physical w/ upper-limbs Impairments Sitting (ALL)
  {
    code: "DA", className: "PIDH Sitting", classFull: "Physical with upper-limb Impairments Sitting",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Sitting",
    buckets: bks("DA", [80, "open"], 80),
  },
  // PIU Standing — Physical Impairments Standing (ALL)
  {
    code: "U", className: "PIU Standing", classFull: "Physical Impairments Standing",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("U", [60, 70, 80, 90, "open"], 90),
  },
  {
    code: "UW", className: "PIU Standing", classFull: "Physical Impairments Standing",
    gender: "F", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("UW", [55, 65, "open"], 65),
  },
  // PIU Junior 23 (14–23)
  {
    code: "UJ", className: "PIU Junior 23", classFull: "Physical Impairments Standing — Junior 23",
    gender: "M", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("UJ", [55, 65, "open"], 65),
  },
  {
    code: "UJW", className: "PIU Junior 23", classFull: "Physical Impairments Standing — Junior 23",
    gender: "F", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("UJW", [50, "open"], 50),
  },
  // PIUH Standing — Physical w/ upper-limbs Impairments Standing (ALL)
  {
    code: "UA", className: "PIUH Standing", classFull: "Physical with upper-limb Impairments Standing",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("UA", [85, "open"], 85),
  },
  {
    code: "UWA", className: "PIUH Standing", classFull: "Physical with upper-limb Impairments Standing",
    gender: "F", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("UWA", [65, "open"], 65),
  },
  // PIUH Junior 23 (14–23) — male only
  {
    code: "UJA", className: "PIUH Junior 23", classFull: "Physical with upper-limb Impairments Standing — Junior 23",
    gender: "M", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("UJA", [60, "open"], 60),
  },
  // VI Visual Standing (ALL)
  {
    code: "E", className: "VI Visual Standing", classFull: "Visual Impairments Standing",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("E", [60, 70, 80, 90, 100, "open"], 100),
  },
  {
    code: "EW", className: "VI Visual Standing", classFull: "Visual Impairments Standing",
    gender: "F", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("EW", [60, 70, "open"], 70),
  },
  // VI Junior 23 (14–23)
  {
    code: "EJ", className: "VI Junior 23", classFull: "Visual Impairments Standing — Junior 23",
    gender: "M", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("EJ", [55, 65, "open"], 65),
  },
  {
    code: "EJW", className: "VI Junior 23", classFull: "Visual Impairments Standing — Junior 23",
    gender: "F", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("EJW", [50, "open"], 50),
  },
  // HI Hearing Standing (ALL)
  {
    code: "H", className: "HI Hearing Standing", classFull: "Hearing Impairments Standing",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("H", [60, 70, 80, 90, 100, "open"], 100),
  },
  {
    code: "HW", className: "HI Hearing Standing", classFull: "Hearing Impairments Standing",
    gender: "F", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("HW", [60, 70, "open"], 70),
  },
  // HI Junior 23 (14–23)
  {
    code: "HJ", className: "HI Junior 23", classFull: "Hearing Impairments Standing — Junior 23",
    gender: "M", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("HJ", [55, 65, "open"], 65),
  },
  {
    code: "HJW", className: "HI Junior 23", classFull: "Hearing Impairments Standing — Junior 23",
    gender: "F", minAge: 14, maxAge: 23, isPara: true, posture: "Standing",
    buckets: bks("HJW", [50, "open"], 50),
  },
  // CPD Sitting — Central Polly (cerebral palsy) Impairments Sitting (ALL) — male only
  {
    code: "DC", className: "CPD Sitting", classFull: "Central Polly Impairments Sitting",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Sitting",
    buckets: bks("DC", [55, 65, "open"], 65),
  },
  // CPU Standing — Central Polly Impairments Standing (ALL) — male only
  {
    code: "UC", className: "CPU Standing", classFull: "Central Polly Impairments Standing",
    gender: "M", minAge: 14, maxAge: null, isPara: true, posture: "Standing",
    buckets: bks("UC", [60, 70, 80, "open"], 80),
  },
];

export const WAF_ALL: WafCategory[] = [...WAF_ABLE, ...WAF_PARA];

/** Lookup by official code. */
export function wafCategory(code: string): WafCategory | undefined {
  return WAF_ALL.find((c) => c.code === code);
}

/** All categories an athlete with this gender + age qualifies for. */
export function wafCategoriesFor(opts: {
  gender: Gender;
  age: number;
  isPara?: boolean;
}): WafCategory[] {
  return WAF_ALL.filter((c) => {
    if (c.gender !== opts.gender) return false;
    if (opts.isPara !== undefined && c.isPara !== opts.isPara) return false;
    if (opts.age < c.minAge) return false;
    if (c.maxAge !== null && opts.age > c.maxAge) return false;
    return true;
  });
}

/** Resolve a measured weight to a bucket within a given category. */
export function wafBucketForWeight(category: WafCategory, weightKg: number): WafBucket {
  for (const b of category.buckets) {
    if (b.upperKg === null) return b;
    if (weightKg <= b.upperKg) return b;
  }
  return category.buckets[category.buckets.length - 1]!;
}
