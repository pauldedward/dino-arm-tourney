/**
 * 38 Tamil Nadu districts (post-2020 reorganisation: Chengalpattu, Kallakurichi,
 * Mayiladuthurai, Ranipet, Tenkasi, Tirupattur added).
 * Source: TN govt revenue department.
 */
export const TN_DISTRICTS = [
  "Ariyalur",
  "Chengalpattu",
  "Chennai",
  "Coimbatore",
  "Cuddalore",
  "Dharmapuri",
  "Dindigul",
  "Erode",
  "Kallakurichi",
  "Kanchipuram",
  "Kanyakumari",
  "Karur",
  "Krishnagiri",
  "Madurai",
  "Mayiladuthurai",
  "Nagapattinam",
  "Namakkal",
  "Nilgiris",
  "Perambalur",
  "Pudukkottai",
  "Ramanathapuram",
  "Ranipet",
  "Salem",
  "Sivaganga",
  "Tenkasi",
  "Thanjavur",
  "Theni",
  "Thoothukudi",
  "Tiruchirappalli",
  "Tirunelveli",
  "Tirupattur",
  "Tiruppur",
  "Tiruvallur",
  "Tiruvannamalai",
  "Tiruvarur",
  "Vellore",
  "Viluppuram",
  "Virudhunagar",
] as const;

export type TNDistrict = (typeof TN_DISTRICTS)[number];

export function isTNDistrict(s: string): s is TNDistrict {
  return (TN_DISTRICTS as readonly string[]).includes(s);
}
