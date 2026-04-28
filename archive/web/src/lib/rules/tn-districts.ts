/**
 * Tamil Nadu districts.
 *
 * Source: existing TN AWA app (33 districts) PLUS the three commonly missing
 * districts (THOOTHUKUDI, THIRUVARUR, KANYAKUMARI) confirmed in the audit at
 * research/09-existing-app-audit.md §4.
 *
 * Sorted alphabetically. Stable canonical UPPER-CASE strings; UI may
 * title-case for display.
 */
export const TN_DISTRICTS = [
  "ARIYALUR",
  "CHENGALPATTU",
  "CHENNAI",
  "COIMBATORE",
  "CUDDALORE",
  "DHARMAPURI",
  "DINDIGUL",
  "ERODE",
  "KALLAKURICHI",
  "KANCHIPURAM",
  "KANYAKUMARI",
  "KARUR",
  "KRISHNAGIRI",
  "MADURAI",
  "MAYILADUTHURAI",
  "NAGAPATTINAM",
  "NAMAKKAL",
  "NILGIRIS",
  "PERAMBALUR",
  "PUDUKKOTTAI",
  "RAMANATHAPURAM",
  "RANIPET",
  "SALEM",
  "SIVAGANGAI",
  "TENKASI",
  "THANJAVUR",
  "THENI",
  "THIRUVARUR",
  "THOOTHUKUDI",
  "TIRUNELVELI",
  "TIRUPATTUR",
  "TIRUPPUR",
  "TIRUVALLUR",
  "TIRUVANNAMALAI",
  "VELLORE",
  "VILLUPURAM",
  "VIRUDHUNAGAR",
] as const;

export type TnDistrict = (typeof TN_DISTRICTS)[number];

export function isTnDistrict(value: string): value is TnDistrict {
  return (TN_DISTRICTS as readonly string[]).includes(value);
}

export function titleCaseDistrict(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
