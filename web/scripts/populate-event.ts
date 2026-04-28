#!/usr/bin/env node
/**
 * populate-event.ts
 *
 * Take the sample TN-State-2026 event and fully populate it with every
 * field a document generator might touch:
 *   - Org + event row
 *   - Branding colours, ID-card content, fee overrides
 *   - Logo / banner / poster (image) / circular (PDF) / signatory image
 *   - 24 registrations covering Men/Women/Para Men/Para Women across
 *     Sub-Junior 15, Junior 18, Youth 23, Senior, Master, Grand Master,
 *     Senior Grand Master, with both single-hand and "B" (R+L) entries
 *   - District AND team affiliations
 *   - Per-athlete photo URL (one shared dummy avatar)
 *   - Payments (verified + pending)
 *   - Weigh-ins for ~half the field
 *   - Entries + single-elim fixtures via the real resolver/bracket
 *   - Renders every PDF (nominal, category, id-cards, fixtures, pending
 *     dues) to research/populate-out/ for visual inspection
 *
 * Usage:  npm run populate:event
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import React from "react";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

import { resolveEntries, type RegistrationLite } from "@/lib/rules/resolve";
import { buildBracket, type SeededEntry } from "@/lib/rules/bracket";
import { WAF_ABLE, WAF_PARA, type WafCategory } from "@/lib/rules/waf-2025";
import { NominalSheet } from "@/lib/pdf/NominalSheet";
import { CategorySheet } from "@/lib/pdf/CategorySheet";
import { IdCardSheet } from "@/lib/pdf/IdCardSheet";
import { FixturesSheet } from "@/lib/pdf/FixturesSheet";

// ─── Constants ──────────────────────────────────────────────────────────────
const ORG_ID = "20000000-0000-0000-0000-000000000000";
let EVENT_ID = "20000000-0000-0000-0000-000000000001";
const REG_PREFIX = "20000000-0000-0000-0000-0000000001";
const PAY_PREFIX = "20000000-0000-0000-0000-0000000002";
const ASSET_PREFIX = `seed/${EVENT_ID}`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "research", "populate-out");
mkdirSync(OUT_DIR, { recursive: true });

// ─── Clients ────────────────────────────────────────────────────────────────
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env missing — run via npm script");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function r2() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const PUBLIC_BUCKET = process.env.R2_PUBLIC_BUCKET!;
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "");

async function uploadPublic(key: string, body: Buffer, contentType: string) {
  await r2().send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  const url = `${PUBLIC_BASE}/${key}`;
  console.log(`  uploaded ${key} (${body.byteLength}B) -> ${url}`);
  return url;
}

// ─── Asset generators ───────────────────────────────────────────────────────
function svgLogo() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#0F3D2E"/>
  <circle cx="200" cy="160" r="92" fill="#F5C518"/>
  <text x="200" y="180" font-family="Helvetica" font-size="72" font-weight="700"
        fill="#0F3D2E" text-anchor="middle">TN</text>
  <text x="200" y="310" font-family="Helvetica" font-size="34" font-weight="700"
        fill="#F6F1E4" text-anchor="middle">TNAWA</text>
  <text x="200" y="350" font-family="Helvetica" font-size="18"
        fill="#CDBB93" text-anchor="middle">Est. 1998</text>
</svg>`;
}

function svgPoster() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0F3D2E"/>
      <stop offset="1" stop-color="#0A1B14"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1200" fill="url(#g)"/>
  <rect x="40" y="40" width="720" height="120" fill="#F5C518"/>
  <text x="400" y="120" font-family="Helvetica" font-size="56" font-weight="700"
        fill="#0F3D2E" text-anchor="middle">TN STATE 2026</text>
  <text x="400" y="280" font-family="Helvetica" font-size="44" font-weight="700"
        fill="#F6F1E4" text-anchor="middle">ARM WRESTLING CHAMPIONSHIP</text>
  <text x="400" y="340" font-family="Helvetica" font-size="28"
        fill="#CDBB93" text-anchor="middle">Sanctioned by PAFI · Affiliated to WAF</text>
  <text x="400" y="600" font-family="Helvetica" font-size="160" font-weight="700"
        fill="#F5C518" text-anchor="middle" opacity="0.18">PULL</text>
  <text x="400" y="900" font-family="Helvetica" font-size="40" font-weight="700"
        fill="#F6F1E4" text-anchor="middle">17 May 2026</text>
  <text x="400" y="950" font-family="Helvetica" font-size="28"
        fill="#F6F1E4" text-anchor="middle">Nehru Indoor Stadium · Chennai</text>
  <text x="400" y="1050" font-family="Helvetica" font-size="22"
        fill="#CDBB93" text-anchor="middle">Entry ₹500 · Prize pool ₹1,50,000</text>
  <text x="400" y="1090" font-family="Helvetica" font-size="20"
        fill="#CDBB93" text-anchor="middle">Register: tnawa.in/state2026</text>
  <text x="400" y="1160" font-family="Helvetica" font-size="14"
        fill="#888" text-anchor="middle">www.tnawa.in · 044-XXXX-XXXX</text>
</svg>`;
}

function svgSignature() {
  // Faux cursive scribble using a path.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100" viewBox="0 0 320 100">
  <rect width="320" height="100" fill="#ffffff"/>
  <path d="M 20 70 C 40 30, 70 30, 90 70 S 140 30, 160 70 S 220 30, 240 70 L 260 60 L 290 80"
        stroke="#0A1B14" stroke-width="3" fill="none" stroke-linecap="round"/>
  <text x="20" y="92" font-family="Helvetica" font-size="11" fill="#666">V. Ramamurthy</text>
</svg>`;
}

function svgAvatar() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <rect width="300" height="400" fill="#CDBB93"/>
  <circle cx="150" cy="140" r="60" fill="#0F3D2E"/>
  <path d="M 60 360 Q 150 240 240 360 Z" fill="#0F3D2E"/>
  <text x="150" y="395" font-family="Helvetica" font-size="14" fill="#0A1B14"
        text-anchor="middle">PHOTO</text>
</svg>`;
}

async function pngFromSvg(svg: string): Promise<Buffer> {
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildCircularPdf(): Promise<Buffer> {
  const s = StyleSheet.create({
    page: { padding: 40, fontSize: 10, color: "#0A1B14" },
    h1: { fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#0F3D2E" },
    h2: { fontSize: 14, fontWeight: 700, marginTop: 14, marginBottom: 6, color: "#0F3D2E" },
    p: { marginBottom: 6, lineHeight: 1.4 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#999", paddingVertical: 3 },
    td: { fontSize: 9 },
  });
  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: s.page },
      React.createElement(Text, { style: s.h1 }, "TN State Arm Wrestling Championship 2026"),
      React.createElement(Text, null, "Official Circular · TNAWA · Affiliated to PAFI / WAF"),
      React.createElement(Text, { style: s.h2 }, "1. Date & Venue"),
      React.createElement(Text, { style: s.p },
        "Sunday, 17 May 2026 · Nehru Indoor Stadium, Chennai. Reporting 08:00, weigh-in 08:30–10:30, opening 11:00."),
      React.createElement(Text, { style: s.h2 }, "2. Entry Fees"),
      React.createElement(View, null,
        React.createElement(View, { style: s.tr },
          React.createElement(Text, { style: [s.td, { flex: 2 }] }, "Senior / Master / Grand Master"),
          React.createElement(Text, { style: [s.td, { width: 80 }] }, "₹500 / hand"),
        ),
        React.createElement(View, { style: s.tr },
          React.createElement(Text, { style: [s.td, { flex: 2 }] }, "Junior 18 / Youth 23"),
          React.createElement(Text, { style: [s.td, { width: 80 }] }, "₹300 / hand"),
        ),
        React.createElement(View, { style: s.tr },
          React.createElement(Text, { style: [s.td, { flex: 2 }] }, "Sub-Junior 15"),
          React.createElement(Text, { style: [s.td, { width: 80 }] }, "₹200 / hand"),
        ),
        React.createElement(View, { style: s.tr },
          React.createElement(Text, { style: [s.td, { flex: 2 }] }, "Para divisions (all)"),
          React.createElement(Text, { style: [s.td, { width: 80 }] }, "Free"),
        ),
      ),
      React.createElement(Text, { style: s.h2 }, "3. Age Categories (WAF 2025)"),
      React.createElement(Text, { style: s.p },
        "Sub-Junior 15: 14–15 · Junior 18: 16–18 · Youth 23: 19–23 · Senior: 23+ · Master: 40+ · Grand Master: 50+ · Senior Grand Master: 60+. Age computed on 31 Dec 2026."),
      React.createElement(Text, { style: s.h2 }, "4. Weigh-In"),
      React.createElement(Text, { style: s.p },
        "Athlete must report with chest number and government ID. Re-weighs allowed within the weigh-in window only. Tolerance: 0.0 kg (no allowance)."),
      React.createElement(Text, { style: s.h2 }, "5. Format"),
      React.createElement(Text, { style: s.p },
        "Single-elimination this season; double-elimination introduced from State 2027. 2-warning, 2-foul DQ rule. Protest fee ₹500, refunded if upheld."),
      React.createElement(Text, { style: s.h2 }, "6. Payment"),
      React.createElement(Text, { style: s.p },
        "Pay via UPI to tnawa@okhdfc (Tamil Nadu Arm Wrestling Association). Upload screenshot + UTR during registration."),
      React.createElement(Text, { style: s.h2 }, "7. Contact"),
      React.createElement(Text, { style: s.p },
        "General Secretary: V. Ramamurthy · 044-XXXX-XXXX · secretary@tnawa.in"),
    ),
    React.createElement(
      Page,
      { size: "A4", style: s.page },
      React.createElement(Text, { style: s.h1 }, "Annexure A — Weight Classes"),
      React.createElement(Text, { style: s.p },
        "Senior Men: −55, −60, −65, −70, −75, −80, −85, −90, −100, −110, +110 kg.\n" +
        "Senior Women: −50, −55, −60, −65, −70, −80, −90, +90 kg.\n" +
        "Junior 18 Men: −50, −55, −60, −65, −70, −75, −80, −90, +90 kg.\n" +
        "Master Men: −60, −70, −80, −90, −100, −110, +110 kg.\n" +
        "Para PIU Standing Men: −60, −70, −80, −90, +90 kg.\n" +
        "Para PID Sitting Women: −55, −65, +65 kg."),
    ),
  );
  return await renderToBuffer(doc);
}

// ─── Athletes (24, covers all key paths) ────────────────────────────────────
type SeedReg = {
  id: string;
  chest_no: number;
  full_name: string;
  initial: string;
  dob: string;
  gender: "M" | "F";
  affiliation_kind: "District" | "Team";
  district: string | null;
  team: string | null;
  mobile: string;
  declared_weight_kg: number;
  nonpara_classes: string[];
  nonpara_hands: ("R" | "L" | "B")[];
  para_codes: string[];
  para_hand: "R" | "L" | "B" | null;
  status: "pending" | "paid" | "weighed_in";
};

function id(n: number) {
  return REG_PREFIX + String(n).padStart(2, "0");
}

const ATHLETES: SeedReg[] = [
  // Senior Men, single hand
  { id: id(1), chest_no: 1, full_name: "Arjun Selvam", initial: "S", dob: "1998-03-12", gender: "M", affiliation_kind: "District", district: "Chennai", team: null, mobile: "9876500001", declared_weight_kg: 78.4, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  { id: id(2), chest_no: 2, full_name: "Karthik Raja", initial: "R", dob: "1995-07-22", gender: "M", affiliation_kind: "District", district: "Coimbatore", team: null, mobile: "9876500002", declared_weight_kg: 88.1, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior Women
  { id: id(3), chest_no: 3, full_name: "Divya Krishnan", initial: "K", dob: "2001-11-05", gender: "F", affiliation_kind: "District", district: "Madurai", team: null, mobile: "9876500003", declared_weight_kg: 58.7, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Junior 18 Men, paid
  { id: id(4), chest_no: 4, full_name: "Suresh Kumar", initial: "P", dob: "2008-05-19", gender: "M", affiliation_kind: "District", district: "Tiruchirappalli", team: null, mobile: "9876500004", declared_weight_kg: 62.3, nonpara_classes: ["JUNIOR 18"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Sub-Junior 15 Women
  { id: id(5), chest_no: 5, full_name: "Lakshmi Priya", initial: "S", dob: "2011-02-14", gender: "F", affiliation_kind: "District", district: "Salem", team: null, mobile: "9876500005", declared_weight_kg: 45.2, nonpara_classes: ["SUB-JUNIOR 15"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior + Master double-class, both hands
  { id: id(6), chest_no: 6, full_name: "Ramesh Babu", initial: "M", dob: "1982-09-30", gender: "M", affiliation_kind: "Team", district: null, team: "Madras Iron Club", mobile: "9876500006", declared_weight_kg: 95.5, nonpara_classes: ["SENIOR", "MASTER"], nonpara_hands: ["B", "R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior Men left hand
  { id: id(7), chest_no: 7, full_name: "Muthu Velan", initial: "S", dob: "1999-12-02", gender: "M", affiliation_kind: "District", district: "Tirunelveli", team: null, mobile: "9876500007", declared_weight_kg: 71.0, nonpara_classes: ["SENIOR"], nonpara_hands: ["L"], para_codes: [], para_hand: null, status: "pending" },
  // Senior Women, paid
  { id: id(8), chest_no: 8, full_name: "Priyanka D", initial: "D", dob: "2003-06-25", gender: "F", affiliation_kind: "Team", district: null, team: "Cauvery Strength Society", mobile: "9876500008", declared_weight_kg: 64.3, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Youth 23 Men
  { id: id(9), chest_no: 9, full_name: "Vijay Anand", initial: "K", dob: "2005-08-17", gender: "M", affiliation_kind: "District", district: "Erode", team: null, mobile: "9876500009", declared_weight_kg: 68.8, nonpara_classes: ["YOUTH 23"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior Men, +110 bucket
  { id: id(10), chest_no: 10, full_name: "Senthil Kumaran", initial: "V", dob: "1990-01-08", gender: "M", affiliation_kind: "District", district: "Thanjavur", team: null, mobile: "9876500010", declared_weight_kg: 112.4, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "weighed_in" },
  // Senior Women, two hands across Senior alone (B)
  { id: id(11), chest_no: 11, full_name: "Meena Kumari", initial: "R", dob: "1996-10-11", gender: "F", affiliation_kind: "District", district: "Tiruppur", team: null, mobile: "9876500011", declared_weight_kg: 71.5, nonpara_classes: ["SENIOR"], nonpara_hands: ["B"], para_codes: [], para_hand: null, status: "paid" },
  // Sub-Junior 15 Men
  { id: id(12), chest_no: 12, full_name: "Bala Subramaniam", initial: "G", dob: "2011-04-03", gender: "M", affiliation_kind: "District", district: "Dindigul", team: null, mobile: "9876500012", declared_weight_kg: 52.0, nonpara_classes: ["SUB-JUNIOR 15"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "pending" },
  // Sub-Junior 15 Women
  { id: id(13), chest_no: 13, full_name: "Kavya Shree", initial: "R", dob: "2011-07-29", gender: "F", affiliation_kind: "District", district: "Kanyakumari", team: null, mobile: "9876500013", declared_weight_kg: 40.5, nonpara_classes: ["SUB-JUNIOR 15"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior + Master + Grand Master triple-class
  { id: id(14), chest_no: 14, full_name: "Gopinath S", initial: "S", dob: "1975-03-18", gender: "M", affiliation_kind: "District", district: "Nilgiris", team: null, mobile: "9876500014", declared_weight_kg: 84.2, nonpara_classes: ["SENIOR", "MASTER", "GRAND MASTER"], nonpara_hands: ["R", "R", "R"], para_codes: [], para_hand: null, status: "paid" },
  // Para Women — PID Sitting (DW)
  { id: id(15), chest_no: 15, full_name: "Indira Devi", initial: "M", dob: "2004-09-14", gender: "F", affiliation_kind: "District", district: "Chennai", team: null, mobile: "9876500015", declared_weight_kg: 63.0, nonpara_classes: [], nonpara_hands: [], para_codes: ["DW"], para_hand: "R", status: "paid" },
  // Para Men — PIU Standing (U)
  { id: id(16), chest_no: 16, full_name: "Raghav Prasad", initial: "V", dob: "1992-11-22", gender: "M", affiliation_kind: "Team", district: null, team: "Coimbatore Para Wing", mobile: "9876500016", declared_weight_kg: 76.4, nonpara_classes: [], nonpara_hands: [], para_codes: ["U"], para_hand: "R", status: "pending" },
  // Senior Men, +110 bucket
  { id: id(17), chest_no: 17, full_name: "Abdul Rahman", initial: "H", dob: "1988-05-07", gender: "M", affiliation_kind: "District", district: "Ramanathapuram", team: null, mobile: "9876500017", declared_weight_kg: 117.0, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior Women
  { id: id(18), chest_no: 18, full_name: "Fathima Begum", initial: "A", dob: "2002-02-28", gender: "F", affiliation_kind: "District", district: "Thoothukudi", team: null, mobile: "9876500018", declared_weight_kg: 54.5, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Master + Grand Master + SGM (60+) — quad-track senior man
  { id: id(19), chest_no: 19, full_name: "Raja Sekhar", initial: "P", dob: "1962-12-15", gender: "M", affiliation_kind: "District", district: "Sivaganga", team: null, mobile: "9876500019", declared_weight_kg: 79.8, nonpara_classes: ["SENIOR", "MASTER", "GRAND MASTER", "SENIOR GRAND MASTER"], nonpara_hands: ["R", "R", "R", "R"], para_codes: [], para_hand: null, status: "paid" },
  // Senior Women both hands
  { id: id(20), chest_no: 20, full_name: "Ananya Srinivasan", initial: "R", dob: "2000-04-09", gender: "F", affiliation_kind: "District", district: "Virudhunagar", team: null, mobile: "9876500020", declared_weight_kg: 68.2, nonpara_classes: ["SENIOR"], nonpara_hands: ["B"], para_codes: [], para_hand: null, status: "paid" },
  // Junior 18 Women + Youth 23 Women bridge — pick the one her age supports
  { id: id(21), chest_no: 21, full_name: "Sandhya Iyer", initial: "P", dob: "2007-03-20", gender: "F", affiliation_kind: "Team", district: null, team: "Madurai Velocity", mobile: "9876500021", declared_weight_kg: 56.7, nonpara_classes: ["JUNIOR 18"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Youth 23 Women
  { id: id(22), chest_no: 22, full_name: "Hema Latha", initial: "K", dob: "2003-01-30", gender: "F", affiliation_kind: "District", district: "Krishnagiri", team: null, mobile: "9876500022", declared_weight_kg: 63.3, nonpara_classes: ["YOUTH 23"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "paid" },
  // Para Men — VI Hearing (HJ — junior)
  { id: id(23), chest_no: 23, full_name: "Naveen Kumar", initial: "B", dob: "2006-11-04", gender: "M", affiliation_kind: "District", district: "Vellore", team: null, mobile: "9876500023", declared_weight_kg: 57.0, nonpara_classes: [], nonpara_hands: [], para_codes: ["HJ"], para_hand: "R", status: "paid" },
  // Pending payment Senior Man (some athletes intentionally left pending
  // to exercise the Payment Report's due column).
  { id: id(24), chest_no: 24, full_name: "Ishaan Mehta", initial: "T", dob: "1994-06-19", gender: "M", affiliation_kind: "District", district: "Chennai", team: null, mobile: "9876500024", declared_weight_kg: 81.4, nonpara_classes: ["SENIOR"], nonpara_hands: ["R"], para_codes: [], para_hand: null, status: "pending" },
];

// ─── Bulk procedural generator ─────────────────────────────────────────────
// Fills every WAF able+para bucket with N synthetic athletes so brackets
// have real depth (1-, 2-, 4-, 8-, 16-person draws). Status is mostly
// "paid" so they all flow into fixtures; a fixed slice stays "pending" so
// the Payment Report keeps content in its Due column.
const FIRST_M = [
  "Aakash", "Bharath", "Chandru", "Deepak", "Eshwar", "Ganesh", "Hari", "Jagan",
  "Kiran", "Lokesh", "Manoj", "Nithin", "Om", "Prakash", "Rohan", "Sathya",
  "Tarun", "Uday", "Vikram", "Yash", "Adhi", "Bala", "Chetan", "Dinesh",
];
const FIRST_F = [
  "Aishwarya", "Brinda", "Chitra", "Deepa", "Eswari", "Geetha", "Harini",
  "Janani", "Kavitha", "Lavanya", "Mythili", "Nandini", "Padma", "Revathi",
  "Saranya", "Tamilselvi", "Uma", "Varsha", "Yamini", "Zara",
];
const LAST = [
  "Ramesh", "Kumar", "Selvam", "Iyer", "Pillai", "Nair", "Subramanian",
  "Krishnan", "Murugan", "Annamalai", "Bhaskar", "Chandran",
];
const DISTRICTS = [
  "Chennai", "Coimbatore", "Madurai", "Salem", "Erode", "Vellore",
  "Tiruchirappalli", "Tirunelveli", "Thanjavur", "Tiruppur", "Dindigul",
  "Kanyakumari", "Nilgiris", "Sivaganga", "Virudhunagar", "Krishnagiri",
  "Thoothukudi", "Ramanathapuram", "Cuddalore", "Karur",
];
const TEAMS = [
  "Madras Iron Club", "Cauvery Strength Society", "Madurai Velocity",
  "Coimbatore Para Wing", "Chola Grip", "Kongu Power Team",
];

function perBucketCount(cat: WafCategory): number {
  if (cat.isPara) return 4;
  switch (cat.className) {
    case "SENIOR": return 8;
    case "MASTER": return 5;
    case "JUNIOR 18": return 6;
    case "YOUTH 23": return 6;
    case "GRAND MASTER": return 4;
    case "SENIOR GRAND MASTER": return 3;
    case "SUB-JUNIOR 15": return 4;
    default: return 3;
  }
}

function weightInsideBucket(upper: number | null, lower: number, n: number): number {
  // Even spread inside the bucket so resolveEntries lands them in this bucket.
  if (upper == null) {
    return Number((lower + 2 + (n * 4)).toFixed(1));
  }
  const span = Math.max(upper - lower - 1, 1);
  const step = span / Math.max(perBucketCountSafe(n), 1);
  return Number((lower + 0.5 + step * (n + 0.5)).toFixed(1));
}
function perBucketCountSafe(_n: number): number { return 8; }

function* generateBulk(startChest: number): Generator<SeedReg> {
  let chest = startChest;
  const cats: WafCategory[] = [...WAF_ABLE, ...WAF_PARA].filter((c) => c.code !== "SPV");
  for (const cat of cats) {
    const N = perBucketCount(cat);
    let prevUpper = (cat.buckets[0]?.upperKg ?? 60) - 10;
    for (const bucket of cat.buckets) {
      for (let i = 0; i < N; i++) {
        chest++;
        const weight = weightInsideBucket(bucket.upperKg, prevUpper, i);
        const ageRange = (cat.maxAge ?? cat.minAge + 8) - cat.minAge;
        const ageBase = cat.minAge + (chest % Math.max(ageRange, 1));
        const dobYear = 2026 - ageBase;
        const month = String(1 + (chest % 12)).padStart(2, "0");
        const day = String(1 + (chest % 27)).padStart(2, "0");
        const isFem = cat.gender === "F";
        const fn = isFem ? FIRST_F[chest % FIRST_F.length] : FIRST_M[chest % FIRST_M.length];
        const ln = LAST[chest % LAST.length];
        const useTeam = chest % 7 === 0;
        const handPick: "R" | "L" | "B" =
          chest % 13 === 0 ? "B" : chest % 6 === 0 ? "L" : "R";
        const paraHand: "R" | "L" = chest % 5 === 0 ? "L" : "R";
        const status: SeedReg["status"] = chest % 17 === 0 ? "pending" : "paid";
        yield {
          id: randomUUID(),
          chest_no: chest,
          full_name: `${fn} ${ln}`,
          initial: ln[0],
          dob: `${dobYear}-${month}-${day}`,
          gender: cat.gender,
          affiliation_kind: useTeam ? "Team" : "District",
          district: useTeam ? null : DISTRICTS[chest % DISTRICTS.length],
          team: useTeam ? TEAMS[chest % TEAMS.length] : null,
          mobile: `987650${String(chest).padStart(4, "0")}`,
          declared_weight_kg: weight,
          nonpara_classes: cat.isPara ? [] : [cat.className],
          nonpara_hands: cat.isPara ? [] : [handPick],
          para_codes: cat.isPara ? [cat.code] : [],
          para_hand: cat.isPara ? paraHand : null,
          status,
        };
      }
      prevUpper = bucket.upperKg ?? prevUpper + 10;
    }
  }
}

const BULK = Array.from(generateBulk(100));
const ALL_REGS: SeedReg[] = [...ATHLETES, ...BULK];

// Derived legacy "division" field for back-compat consumers.
function legacyDivision(r: SeedReg): "Men" | "Women" | "Para Men" | "Para Women" {
  const para = r.para_codes.length > 0;
  if (r.gender === "F") return para ? "Para Women" : "Women";
  return para ? "Para Men" : "Men";
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const sb = svc();

  // 1. Build & upload assets ------------------------------------------------
  console.log("[assets] generating");
  const [logoPng, posterPng, sigPng, avatarPng, circularPdf] = await Promise.all([
    pngFromSvg(svgLogo()),
    pngFromSvg(svgPoster()),
    pngFromSvg(svgSignature()),
    pngFromSvg(svgAvatar()),
    buildCircularPdf(),
  ]);

  console.log("[assets] uploading to R2");
  const [logoUrl, posterUrl, sigUrl, avatarUrl, circularUrl] = await Promise.all([
    uploadPublic(`${ASSET_PREFIX}/logo.png`, logoPng, "image/png"),
    uploadPublic(`${ASSET_PREFIX}/poster.png`, posterPng, "image/png"),
    uploadPublic(`${ASSET_PREFIX}/signature.png`, sigPng, "image/png"),
    uploadPublic(`${ASSET_PREFIX}/avatar.png`, avatarPng, "image/png"),
    uploadPublic(`${ASSET_PREFIX}/circular.pdf`, circularPdf, "application/pdf"),
  ]);

  // 2. Org -------------------------------------------------------------------
  console.log("[db] org");
  // Reuse existing org by slug if present (its id will become the FK target).
  const { data: existingOrg } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", "tnawa")
    .maybeSingle();
  let orgId = ORG_ID;
  if (existingOrg) {
    orgId = existingOrg.id;
    console.log("  reusing existing org " + orgId);
  } else {
    const { error: orgErr } = await sb.from("organizations").insert({
      id: ORG_ID,
      slug: "tnawa",
      name: "Tamil Nadu Arm Wrestling Association",
      kind: "federation",
      country: "IN",
      region: "Tamil Nadu",
    });
    if (orgErr) throw orgErr;
  }

  // 3. Event with EVERY column ----------------------------------------------
  console.log("[db] event");
  // Resolve event id by slug if present.
  const { data: existingEv } = await sb
    .from("events")
    .select("id")
    .eq("slug", "tn-state-2026")
    .maybeSingle();
  EVENT_ID = existingEv?.id ?? EVENT_ID;
  const { error: evErr } = await sb.from("events").upsert(
    {
      id: EVENT_ID,
      organization_id: orgId,
      slug: "tn-state-2026",
      name: "TN State Arm Wrestling Championship 2026",
      status: "open",
      starts_at: "2026-05-17T03:30:00Z",
      ends_at: "2026-05-17T14:00:00Z",
      venue_name: "Nehru Indoor Stadium",
      venue_city: "Chennai",
      venue_state: "Tamil Nadu",
      hand: "both",
      description:
        "Open state championship — sanctioned by PAFI, affiliated to WAF. Senior, Master, GM, SGM, Junior 18, Youth 23, Sub-Junior 15, plus para divisions.",
      cover_url: posterUrl,
      entry_fee_inr: 500,
      currency: "INR",
      prize_pool_inr: 150000,
      registration_opens_at: "2026-04-01T00:00:00Z",
      registration_closes_at: "2026-05-15T18:30:00Z",
      weigh_in_starts_at: "2026-05-17T03:00:00Z",
      weigh_in_ends_at: "2026-05-17T05:00:00Z",
      registration_published_at: "2026-04-01T00:00:00Z",
      payment_provider: "manual_upi",
      upi_id: "tnawa@okhdfc",
      upi_payee_name: "Tamil Nadu Arm Wrestling Association",
      entry_fee_default_inr: 500,
      fee_overrides: {
        "JUNIOR 18": 300,
        "YOUTH 23": 300,
        "SUB-JUNIOR 15": 200,
        para: 0,
      },
      logo_url: logoUrl,
      banner_url: posterUrl,
      poster_url: posterUrl,
      poster_kind: "image",
      circular_url: circularUrl,
      primary_color: "#0F3D2E",
      accent_color: "#F5C518",
      text_on_primary: "#FFFFFF",
      id_card_template: "tnawa_v1",
      id_card_org_name: "Tamil Nadu Arm Wrestling Association",
      id_card_event_title: "TN State Championship 2026",
      id_card_subtitle: "Chennai · 17 May 2026",
      id_card_footer: "Registered with PAFI · Affiliated to WAF",
      id_card_signatory_name: "V. Ramamurthy",
      id_card_signatory_title: "General Secretary",
      id_card_signature_url: sigUrl,
    },
    { onConflict: "id" }
  );
  if (evErr) throw evErr;

  // 4. Wipe prior fixtures/entries/weigh_ins/payments/regs for this event ---
  console.log("[db] wipe prior children");
  await sb.from("fixtures").delete().eq("event_id", EVENT_ID);
  const { data: oldRegs } = await sb
    .from("registrations")
    .select("id")
    .eq("event_id", EVENT_ID);
  const oldIds = (oldRegs ?? []).map((r) => r.id);
  for (let i = 0; i < oldIds.length; i += 200) {
    const slice = oldIds.slice(i, i + 200);
    await sb.from("entries").delete().in("registration_id", slice);
    await sb.from("weigh_ins").delete().in("registration_id", slice);
    await sb.from("payments").delete().in("registration_id", slice);
  }
  await sb.from("registrations").delete().eq("event_id", EVENT_ID);

  // 4b. Ensure auth user + profile + athlete row for each seed athlete -----
  console.log("[auth] ensuring users for " + ALL_REGS.length + " athletes");
  // Fetch existing seed users in one shot.
  const existingByEmail = new Map<string, string>();
  // Paginate through admin.listUsers (page 1 should hold them all for seed).
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email && u.email.startsWith("seed-athlete-")) {
        existingByEmail.set(u.email, u.id);
      }
    }
    if (data.users.length < 200) break;
  }

  const athleteUserIds = new Map<string, string>(); // SeedReg.id -> user uuid
  for (const a of ALL_REGS) {
    const email = `seed-athlete-${a.chest_no}@example.test`;
    let uid = existingByEmail.get(email);
    if (!uid) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password: "seed-pass-" + a.chest_no,
        email_confirm: true,
        user_metadata: { full_name: a.full_name, seed: true },
      });
      if (error) throw error;
      uid = data.user!.id;
    }
    athleteUserIds.set(a.id, uid);
  }

  // Upsert profile + athlete rows.
  const profileRows = ALL_REGS.map((a) => ({
    id: athleteUserIds.get(a.id)!,
    full_name: a.full_name,
    phone: a.mobile,
    role: "athlete",
  }));
  const { error: profErr } = await sb
    .from("profiles")
    .upsert(profileRows, { onConflict: "id" });
  if (profErr) throw profErr;

  const athleteRows = ALL_REGS.map((a) => ({
    id: athleteUserIds.get(a.id)!,
    date_of_birth: a.dob,
    gender: a.gender,
    state: "Tamil Nadu",
    district: a.district,
  }));
  const { error: athErr } = await sb
    .from("athletes")
    .upsert(athleteRows, { onConflict: "id" });
  if (athErr) throw athErr;

  // 5. Insert registrations -------------------------------------------------
  console.log(`[db] registrations (${ALL_REGS.length})`);
  const regRows = ALL_REGS.map((r) => ({
    id: r.id,
    event_id: EVENT_ID,
    athlete_id: athleteUserIds.get(r.id)!,
    weight_class_code: r.gender === "F" ? "SW-OPN" : "SM-OPN", // legacy NOT NULL
    hand: r.nonpara_hands[0] === "L" ? "left" : "right",
    status: r.status,
    chest_no: r.chest_no,
    initial: r.initial,
    full_name: r.full_name,
    dob: r.dob,
    division: legacyDivision(r),
    affiliation_kind: r.affiliation_kind,
    district: r.district,
    team: r.team,
    mobile: r.mobile,
    declared_weight_kg: r.declared_weight_kg,
    age_categories: r.nonpara_classes.length ? r.nonpara_classes : (r.para_codes.length ? ["PARA"] : []),
    youth_hand: null,
    senior_hand: null,
    photo_url: avatarUrl,
    photo_bytes: avatarPng.byteLength,
    submitted_by: "populate-event",
    gender: r.gender,
    nonpara_classes: r.nonpara_classes,
    nonpara_hand: r.nonpara_hands[0] ?? null,
    nonpara_hands: r.nonpara_hands,
    para_codes: r.para_codes,
    para_hand: r.para_hand,
  }));
  const { error: regErr } = await sb.from("registrations").insert(regRows);
  if (regErr) throw regErr;

  // 6. Payments -------------------------------------------------------------
  console.log("[db] payments");
  const payRows = ALL_REGS.map((r) => {
    const amount = r.nonpara_classes.length
      ? r.nonpara_classes.includes("SUB-JUNIOR 15") ? 200
        : (r.nonpara_classes.includes("JUNIOR 18") || r.nonpara_classes.includes("YOUTH 23")) ? 300
          : 500
      : 0;
    const verified = r.status !== "pending";
    return {
      id: randomUUID(),
      registration_id: r.id,
      amount_inr: amount,
      method: amount === 0 ? "waiver" : "manual_upi",
      utr: verified && amount > 0 ? `UTR${String(r.chest_no).padStart(10, "0")}` : null,
      proof_url: verified && amount > 0 ? avatarUrl : null,
      status: verified ? "verified" : "pending",
      verified_at: verified ? new Date().toISOString() : null,
      notes: verified ? "auto-verified by populate-event" : "awaiting upload",
    };
  });
  const { error: payErr } = await sb.from("payments").insert(payRows);
  if (payErr) throw payErr;

  // 7. Weigh-ins for the weighed_in subset (force a few more so brackets fill)
  console.log("[db] weigh_ins");
  const weighedTargets = ALL_REGS.filter((r, i) => r.status !== "pending" && i % 2 === 0);
  // promote them to weighed_in too
  await sb
    .from("registrations")
    .update({ status: "weighed_in" })
    .in("id", weighedTargets.map((r) => r.id));
  const wiRows = weighedTargets.map((r) => {
    const jitter = (Math.random() - 0.5) * 1.6;
    const kg = Math.max(25, Math.min(180, r.declared_weight_kg + jitter));
    return {
      registration_id: r.id,
      measured_kg: Number(kg.toFixed(2)),
      live_photo_url: avatarUrl,
      scale_photo_url: avatarUrl,
      weighed_by: null,
    };
  });
  if (wiRows.length) {
    const { error } = await sb.from("weigh_ins").insert(wiRows);
    if (error) throw error;
  }

  // 8. Build entries + fixtures (mirror /api/fixtures/generate) ------------
  console.log("[db] entries + fixtures");
  const eligible = ALL_REGS.filter((r) => r.status !== "pending");
  const wiByReg = new Map(wiRows.map((w) => [w.registration_id, { measured_kg: w.measured_kg }]));
  const refYear = 2026;
  type GE = {
    registration_id: string;
    chest_no: number;
    district: string | null;
    team: string | null;
    division: string;
    age_band: string;
    weight_class: string;
    hand: "R" | "L";
    category_code: string;
  };
  const allEntries: GE[] = [];
  for (const r of eligible) {
    const lite: RegistrationLite = {
      id: r.id,
      gender: r.gender,
      declared_weight_kg: r.declared_weight_kg,
      nonpara_classes: r.nonpara_classes,
      nonpara_hands: r.nonpara_hands,
      para_codes: r.para_codes,
      para_hand: r.para_hand,
    };
    const resolved = resolveEntries(lite, wiByReg.get(r.id) ?? null, refYear);
    for (const e of resolved) {
      allEntries.push({ chest_no: r.chest_no, district: r.district, team: r.team, ...e });
    }
  }

  if (allEntries.length === 0) {
    console.warn("[warn] no eligible entries resolved");
  } else {
    const { data: insertedEntries, error: entErr } = await sb
      .from("entries")
      .insert(
        allEntries.map((e) => ({
          registration_id: e.registration_id,
          division: e.division,
          age_band: e.age_band,
          weight_class: e.weight_class,
          hand: e.hand,
          category_code: e.category_code,
        }))
      )
      .select("id, registration_id, category_code");
    if (entErr) throw entErr;

    const entryIdByKey = new Map<string, string>();
    for (const ent of insertedEntries ?? []) {
      entryIdByKey.set(`${ent.registration_id}|${ent.category_code}`, ent.id);
    }

    const byCat = new Map<string, GE[]>();
    for (const e of allEntries) {
      if (!byCat.has(e.category_code)) byCat.set(e.category_code, []);
      byCat.get(e.category_code)!.push(e);
    }
    const fixtureRows: {
      event_id: string;
      category_code: string;
      round_no: number;
      match_no: number;
      entry_a_id: string | null;
      entry_b_id: string | null;
    }[] = [];
    for (const [code, list] of byCat) {
      const seeded: SeededEntry[] = list
        .slice()
        .sort((a, b) => a.chest_no - b.chest_no)
        .map((e) => ({
          entry_id: entryIdByKey.get(`${e.registration_id}|${code}`)!,
          district: e.district,
          team: e.team,
        }));
      const planned = buildBracket(seeded);
      for (const m of planned) {
        fixtureRows.push({
          event_id: EVENT_ID,
          category_code: code,
          round_no: m.round_no,
          match_no: m.match_no,
          entry_a_id: m.a_entry_id,
          entry_b_id: m.b_entry_id,
        });
      }
    }
    if (fixtureRows.length) {
      const { error } = await sb.from("fixtures").insert(fixtureRows);
      if (error) throw error;
    }
    console.log(
      `[db] categories=${byCat.size} entries=${insertedEntries?.length ?? 0} fixtures=${fixtureRows.length}`
    );
  }

  // 9. Render every PDF to disk for a sanity check --------------------------
  console.log("[pdf] rendering to " + OUT_DIR);

  const { data: regsFinal } = await sb
    .from("registrations")
    .select("*")
    .eq("event_id", EVENT_ID)
    .order("chest_no");

  const regIds = (regsFinal ?? []).map((r) => r.id);
  // Chunk in() — Supabase sends GET with the list in the URL; large lists
  // silently truncate or 414. Hard cap of 200 IDs per request is safe.
  async function fetchByRegIds<T>(
    table: string,
    cols: string,
    mapRow: (rows: unknown[]) => T[]
  ): Promise<T[]> {
    const out: unknown[] = [];
    for (let i = 0; i < regIds.length; i += 200) {
      const slice = regIds.slice(i, i + 200);
      const { data, error } = await sb
        .from(table)
        .select(cols)
        .in("registration_id", slice);
      if (error) throw error;
      if (data) out.push(...data);
    }
    return mapRow(out);
  }

  const entriesFinal = await fetchByRegIds<{
    id: string;
    registration_id: string;
    category_code: string;
    division: string;
    age_band: string;
    weight_class: string;
    hand: string;
  }>(
    "entries",
    "id, registration_id, category_code, division, age_band, weight_class, hand",
    (rows) => rows as never
  );

  const payFinal = await fetchByRegIds<{
    amount_inr: number;
    status: string;
    registration_id: string;
  }>(
    "payments",
    "amount_inr, status, registration_id",
    (rows) => rows as never
  );

  const { data: fixFinal } = await sb
    .from("fixtures")
    .select("category_code, round_no, match_no, entry_a_id, entry_b_id")
    .eq("event_id", EVENT_ID)
    .order("category_code")
    .order("round_no")
    .order("match_no");

  const eventForPdf = {
    name: "TN State Arm Wrestling Championship 2026",
    primary_color: "#0F3D2E",
    accent_color: "#F5C518",
    text_on_primary: "#FFFFFF",
    id_card_org_name: "Tamil Nadu Arm Wrestling Association",
    id_card_event_title: "TN State Championship 2026",
    id_card_subtitle: "Chennai · 17 May 2026",
    id_card_footer: "Registered with PAFI · Affiliated to WAF",
    id_card_signatory_name: "V. Ramamurthy",
    id_card_signatory_title: "General Secretary",
  };

  const nominalRows = (regsFinal ?? []).map((r) => ({
    chest_no: r.chest_no,
    full_name: r.full_name,
    division: r.division,
    district: r.district,
    team: r.team,
    declared_weight_kg: r.declared_weight_kg,
    age_categories: r.age_categories as string[] | null,
    status: r.status,
  }));
  await writePdf("nominal.pdf", React.createElement(NominalSheet, { event: eventForPdf, rows: nominalRows }));

  const idRows = (regsFinal ?? []).map((r) => ({
    chest_no: r.chest_no,
    full_name: r.full_name,
    division: r.division,
    district: r.district,
    team: r.team,
    declared_weight_kg: r.declared_weight_kg,
  }));
  await writePdf("id-cards.pdf", React.createElement(IdCardSheet, { event: eventForPdf, rows: idRows }));

  const regById = new Map((regsFinal ?? []).map((r) => [r.id, r]));
  const entryById = new Map((entriesFinal ?? []).map((e) => [e.id, e]));

  const catGroups = new Map<string, { chest_no: number | null; full_name: string | null; district: string | null }[]>();
  for (const e of entriesFinal ?? []) {
    const reg = regById.get(e.registration_id);
    if (!catGroups.has(e.category_code)) catGroups.set(e.category_code, []);
    catGroups.get(e.category_code)!.push({
      chest_no: reg?.chest_no ?? null,
      full_name: reg?.full_name ?? null,
      district: reg?.district ?? null,
    });
  }
  const categories = Array.from(catGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category_code, athletes]) => ({ category_code, athletes }));
  await writePdf("category.pdf", React.createElement(CategorySheet, { event: eventForPdf, categories }));

  const fxByCat = new Map<string, Map<number, { match_no: number; a: string | null; b: string | null }[]>>();
  function labelFor(entryId: string | null): string | null {
    if (!entryId) return null;
    const ent = entryById.get(entryId);
    if (!ent) return null;
    const r = regById.get(ent.registration_id);
    if (!r) return null;
    return `#${r.chest_no ?? ""} ${r.full_name ?? ""}`;
  }
  for (const f of fixFinal ?? []) {
    if (!fxByCat.has(f.category_code)) fxByCat.set(f.category_code, new Map());
    const byRound = fxByCat.get(f.category_code)!;
    if (!byRound.has(f.round_no)) byRound.set(f.round_no, []);
    byRound.get(f.round_no)!.push({
      match_no: f.match_no,
      a: labelFor(f.entry_a_id),
      b: labelFor(f.entry_b_id),
    });
  }
  const fxCategories = Array.from(fxByCat.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, byRound]) => ({
      category_code: code,
      rounds: Array.from(byRound.entries())
        .sort(([a], [b]) => a - b)
        .map(([round_no, matches]) => ({ round_no, matches })),
    }));
  await writePdf("fixtures.pdf", React.createElement(FixturesSheet, { event: eventForPdf, categories: fxCategories }));

  console.log("\nDONE.");
  console.log("  event:        " + EVENT_ID);
  console.log("  registrations:" + (regsFinal?.length ?? 0));
  console.log("  entries:      " + (entriesFinal?.length ?? 0));
  console.log("  fixtures:     " + (fixFinal?.length ?? 0));
  console.log("  pdfs out:     " + OUT_DIR);
  console.log("  poster:       " + posterUrl);
  console.log("  circular:     " + circularUrl);
  console.log("  logo:         " + logoUrl);
}

async function writePdf(name: string, doc: React.ReactElement) {
  const buf = await renderToBuffer(doc);
  const path = join(OUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`  ${name.padEnd(20)} ${(buf.byteLength / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
