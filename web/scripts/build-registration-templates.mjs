/**
 * Build TWO smart Excel intake templates for district officials:
 *
 *   • Athlete-Registration-Non-Para.xlsx  → able-bodied WAF age-class entries
 *   • Athlete-Registration-Para.xlsx      → WAF para-armwrestling entries
 *
 * Shape matches `validateRegistration()` in
 *   web/src/lib/rules/registration-rules.ts
 * and the POST body of /api/register/route.ts:
 *   - mobile: exactly 10 digits
 *   - aadhaar: optional, exactly 12 digits
 *   - dob: YYYY-MM-DD; AGE is computed on the event start date (match day),
 *     per the WAF/ageOnMatchDay convention. The event date lives in cell
 *     C1 of the Athletes sheet so the formula works without a script.
 *   - affiliation: District (TN dropdown) OR Team (free text)
 *
 * Run:  node web/scripts/build-registration-templates.mjs
 */

import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── Reference data (mirrors web/src/lib/rules) ───────────────────────────
const TN_DISTRICTS = [
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri",
  "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur",
  "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris",
  "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga",
  "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
  "Tirupattur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore",
  "Viluppuram", "Virudhunagar",
];

const AGE_CLASSES = [
  { name: "SUB-JUNIOR 15",             min: 14, max: 15 },
  { name: "JUNIOR 18",                 min: 16, max: 18 },
  { name: "YOUTH 23",                  min: 19, max: 23 },
  { name: "SENIOR",                    min: 23, max: null },
  { name: "MASTER",                    min: 40, max: null },
  { name: "GRAND MASTER",              min: 50, max: null },
  { name: "SENIOR GRAND MASTER",       min: 60, max: null },
  { name: "SUPER SENIOR GRAND MASTER", min: 70, max: null },
];

const PARA_CLASSES = [
  { code: "PID Sitting",       posture: "Sitting",  label: "PID — Physical Impairments (Sitting)" },
  { code: "PIDH Sitting",      posture: "Sitting",  label: "PIDH — Physical w/ upper-limb (Sitting)" },
  { code: "PIU Standing",      posture: "Standing", label: "PIU — Physical Impairments (Standing)" },
  { code: "PIU Junior 23",     posture: "Standing", label: "PIU Junior 23 (14–23, Standing)" },
  { code: "PIUH Standing",     posture: "Standing", label: "PIUH — Physical w/ upper-limb (Standing)" },
  { code: "PIUH Junior 23",    posture: "Standing", label: "PIUH Junior 23 (14–23, Standing, M only)" },
  { code: "VI Visual Standing",posture: "Standing", label: "VI — Visual Impairments (Standing)" },
  { code: "VI Junior 23",      posture: "Standing", label: "VI Junior 23 (14–23, Standing)" },
  { code: "HI Hearing Standing",posture:"Standing", label: "HI — Hearing Impairments (Standing)" },
  { code: "HI Junior 23",      posture: "Standing", label: "HI Junior 23 (14–23, Standing)" },
  { code: "CPD Sitting",       posture: "Sitting",  label: "CPD — Cerebral Palsy (Sitting, M only)" },
  { code: "CPU Standing",      posture: "Standing", label: "CPU — Cerebral Palsy (Standing, M only)" },
];

const HANDS = ["R", "L", "B"];
const GENDERS = ["M", "F"];
const AFFILIATIONS = ["District", "Team"];
const ROWS = 250;

// ── Helpers ──────────────────────────────────────────────────────────────
const colLetter = (i) => {
  let n = i, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const listDV = (formula) => ({
  type: "list", allowBlank: true, formulae: [formula], showErrorMessage: true,
  errorStyle: "stop", errorTitle: "Pick from list", error: "Use the dropdown arrow.",
});

// Softer, calmer palette — readable on screen and on a printed sheet.
const FILL_HDR_REQ = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } }; // indigo-900
const FILL_HDR_OPT = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } }; // slate-600
const FILL_REQ     = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } }; // blue-50
const FILL_EVENT   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } }; // amber-100
const FILL_COMPUTED= { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; // slate-100
const FILL_STRIPE  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } }; // zinc-50
const FILL_RED     = { type: "pattern", pattern: "solid", bgColor: { argb: "FFFECACA" } }; // red-200

// ── Per-track config ─────────────────────────────────────────────────────
const COMMON_COLS = [
  { key: "no",        header: "#",                width: 5,  required: false, computed: true },
  { key: "name",      header: "Full Name",        width: 28, required: true  },
  { key: "initial",   header: "Initial",          width: 8,  required: false },
  { key: "mobile",    header: "Mobile (10-digit)",width: 14, required: true  },
  { key: "aadhaar",   header: "Aadhaar (12-digit, opt)", width: 16, required: false },
  { key: "dob",       header: "DOB (date)",       width: 14, required: true  },
  { key: "age",       header: "Age (auto)",       width: 8,  required: false, computed: true },
  { key: "gender",    header: "Gender",           width: 8,  required: true  },
  { key: "afftype",   header: "Affiliation",      width: 12, required: true  },
  { key: "district",  header: "District (if Affiliation = District)", width: 22, required: false },
  { key: "team",      header: "Team (if Affiliation = Team)",         width: 22, required: false },
  { key: "weight",    header: "Declared Wt (kg)", width: 12, required: true  },
];

const TRACK_NON_PARA = {
  outFile: "Athlete-Registration-Non-Para.xlsx",
  workbookTitle: "Non-Para Athlete Registration",
  sheetTitle: "Athletes (Non-Para)",
  tabColor: "FF065F46",
  trackBlurb: "ABLE-BODIED ATHLETES (Non-Para)",
  extraCols: [
    { key: "ageclass",  header: "Age Category",           width: 24, required: true  },
    { key: "hand",      header: "Hand (R / L / B)",       width: 14, required: true  },
    { key: "compup",    header: "Also compete in SENIOR?",width: 18, required: false },
    { key: "srhand",    header: "Senior Hand (R / L / B)",width: 16, required: false },
    { key: "notes",     header: "Notes",                  width: 30, required: false },
  ],
  sample: {
    name: "EXAMPLE — Ramesh Kumar", initial: "S", mobile: "9876543210",
    dob: new Date(Date.UTC(2002, 5, 15)), gender: "M",
    afftype: "District", district: "Coimbatore", weight: 78.4,
    ageclass: "YOUTH 23", hand: "R",
    compup: "No", notes: "Delete this row before sending.",
  },
};

const TRACK_PARA = {
  outFile: "Athlete-Registration-Para.xlsx",
  workbookTitle: "Para Athlete Registration",
  sheetTitle: "Athletes (Para)",
  tabColor: "FF1D4ED8",
  trackBlurb: "PARA-ARMWRESTLING ATHLETES",
  extraCols: [
    { key: "para",     header: "Para Class", width: 22, required: true  },
    { key: "parahand", header: "Hand",       width: 8,  required: true  },
    { key: "notes",    header: "Notes",      width: 30, required: false },
  ],
  sample: {
    name: "EXAMPLE — Priya S.", initial: "K", mobile: "9123456780",
    dob: new Date(Date.UTC(1995, 2, 8)), gender: "F",
    afftype: "Team", team: "Madurai Para Club", weight: 58.0,
    para: "PIU Standing", parahand: "R", notes: "Delete this row before sending.",
  },
};

// ── Builder ──────────────────────────────────────────────────────────────
async function buildWorkbook(track) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dino Arm Tourney";
  wb.created = new Date();
  wb.title = track.workbookTitle;

  buildReadMeSheet(wb, track);
  const ranges = buildListsSheet(wb, track);
  buildAthletesSheet(wb, track, ranges);
  if (track === TRACK_NON_PARA) buildAgeEligibilitySheet(wb);
  if (track === TRACK_PARA) buildParaClassesSheet(wb);

  const out = path.join(REPO_ROOT, track.outFile);
  await wb.xlsx.writeFile(out);
  console.log(`Wrote ${out}`);
}

function buildReadMeSheet(wb, track) {
  const ws = wb.addWorksheet("READ ME FIRST", {
    properties: { tabColor: { argb: "FFB91C1C" } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 4 }, { width: 110 }];

  const isPara = track === TRACK_PARA;
  const lines = [
    ["", `${track.trackBlurb} — DISTRICT INTAKE SHEET`, "title"],
    ["", "", ""],
    ["", "Step 1 — Set the event date", "h2"],
    ["", "Open the 'Athletes' tab. Fill cell C1 (Event Start Date). Age in column G is computed against this date (WAF match-day rule).", ""],
    ["", "", ""],
    ["", "Step 2 — Fill one row per athlete", "h2"],
    ["1.", "Do not insert/delete columns or rename headers.", ""],
    ["2.", "BLUE headers = required. SLATE headers = optional. Required cells start light blue and turn red if you leave them blank after entering a name.", ""],
    ["3.", "Use the dropdown arrows wherever they appear — do not type values free-hand.", ""],
    ["4.", "Click the DOB cell to enter a date. Format is YYYY-MM-DD.", ""],
    ["5.", "Mobile must be exactly 10 digits, no +91 prefix, no spaces.", ""],
    ["6.", "Aadhaar is OPTIONAL. If entered, must be exactly 12 digits. Treat as confidential.", ""],
    ["7.", "Affiliation: pick District for federation entries (then choose the TN district), or Team for club/league entries (then type the team name).", ""],
    ["8.", "Declared Weight is in KILOGRAMS. Decimals allowed (e.g. 78.4). Exact bracket bucket (e.g. −80 kg) is assigned at weigh-in — do NOT enter weight classes manually.", ""],
    ["", "", ""],
    isPara
      ? ["", "Para specifics", "h2"]
      : ["", "Non-Para specifics", "h2"],
    isPara
      ? ["•", "Pick exactly ONE Para Class and ONE Hand. See the 'Para Classes' tab for codes.", ""]
      : ["•", "Pick the athlete's primary AGE CATEGORY, then their HAND (R = Right, L = Left, B = Both means they enter both right and left brackets).", ""],
    isPara
      ? ["•", "Para is single-arm: athlete declares one competing arm.", ""]
      : ["•", "If the athlete will ALSO enter Senior (compete-up — typically 16-18 yr olds, or a Master moving down), set 'Also compete in SENIOR?' to Yes and pick the Senior Hand.", ""],
    isPara
      ? ["•", "An athlete who competes in BOTH para and able-bodied tracks is rare — please use the Non-Para sheet for that case and contact the organiser.", ""]
      : ["•", "See the 'Age Eligibility' tab for which classes apply at which age.", ""],
    ["", "", ""],
    ["", "Questions: contact the event organiser before sending the sheet back.", "small"],
  ];
  for (const [a, b, kind] of lines) {
    const row = ws.addRow([a, b]);
    if (kind === "title") {
      row.font = { bold: true, size: 18, color: { argb: "FFB91C1C" } };
      row.height = 28;
    } else if (kind === "h2") {
      row.font = { bold: true, size: 13 };
      row.height = 22;
    } else if (kind === "small") {
      row.font = { italic: true, color: { argb: "FF6B7280" } };
    } else {
      row.alignment = { wrapText: true, vertical: "top" };
      row.font = { size: 11 };
    }
  }
}

function buildListsSheet(wb, track) {
  const ws = wb.addWorksheet("Lists", { state: "hidden" });
  function writeList(col, header, values) {
    ws.getCell(`${col}1`).value = header;
    ws.getCell(`${col}1`).font = { bold: true };
    values.forEach((v, i) => { ws.getCell(`${col}${i + 2}`).value = v; });
    return `Lists!$${col}$2:$${col}$${values.length + 1}`;
  }
  return {
    GENDER:   writeList("A", "Gender",     GENDERS),
    DISTRICT: writeList("B", "District",   TN_DISTRICTS),
    AGECLASS: writeList("C", "Age Class",  AGE_CLASSES.map((c) => c.name)),
    PARA:     writeList("D", "Para Class", PARA_CLASSES.map((c) => c.code)),
    HAND:     writeList("E", "Hand",       HANDS),
    YESNO:    writeList("F", "Yes/No",     ["Yes", "No"]),
    AFF:      writeList("G", "Affiliation", AFFILIATIONS),
  };
}

function buildAthletesSheet(wb, track, R) {
  const ws = wb.addWorksheet(track.sheetTitle, {
    properties: { tabColor: { argb: track.tabColor } },
    views: [{ state: "frozen", xSplit: 2, ySplit: 3 }], // freeze meta + header
  });

  const cols = [...COMMON_COLS, ...track.extraCols];
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const COL = Object.fromEntries(cols.map((c, i) => [c.key, colLetter(i + 1)]));

  // ── Row 1: event meta block ────────────────────────────────────────────
  ws.getCell("A1").value = "EVENT START DATE →";
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: "FF1E3A8A" } };
  ws.getCell("A1").alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells("A1:B1");

  ws.getCell("C1").value = null; // officer fills this
  ws.getCell("C1").numFmt = "yyyy-mm-dd";
  ws.getCell("C1").fill = FILL_EVENT;
  ws.getCell("C1").font = { bold: true, size: 12 };
  ws.getCell("C1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("C1").border = {
    top: { style: "medium", color: { argb: "FF1E3A8A" } },
    bottom: { style: "medium", color: { argb: "FF1E3A8A" } },
    left: { style: "medium", color: { argb: "FF1E3A8A" } },
    right: { style: "medium", color: { argb: "FF1E3A8A" } },
  };
  ws.getCell("C1").dataValidation = {
    type: "date", operator: "between", allowBlank: false,
    formulae: [new Date(2024, 0, 1), new Date(2030, 11, 31)],
    showInputMessage: true,
    promptTitle: "Event Start Date",
    prompt: "Enter the event date as YYYY-MM-DD. Age (column G) is calculated against this date.",
    showErrorMessage: true, errorStyle: "stop",
    errorTitle: "Invalid date",
    error: "Enter a valid event date (YYYY-MM-DD).",
  };

  ws.getCell("D1").value = "(Age in column G is computed against this date — WAF match-day rule.)";
  ws.getCell("D1").font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };
  ws.mergeCells(`D1:${colLetter(cols.length)}1`);

  // ── Row 2: spacer (blank) ──────────────────────────────────────────────
  ws.getRow(2).height = 6;

  // ── Row 3: column headers ──────────────────────────────────────────────
  const headerRow = ws.getRow(3);
  headerRow.values = cols.map((c) => c.header);
  headerRow.height = 32;
  cols.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = c.required ? FILL_HDR_REQ : FILL_HDR_OPT;
    cell.border = {
      top:    { style: "thin",   color: { argb: "FF0F172A" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      left:   { style: "thin",   color: { argb: "FF0F172A" } },
      right:  { style: "thin",   color: { argb: "FF0F172A" } },
    };
  });

  // ── Body rows (rows 4 .. ROWS+3) ───────────────────────────────────────
  const FIRST = 4;
  const LAST = ROWS + 3;
  for (let r = FIRST; r <= LAST; r++) {
    if (COL.no) {
      ws.getCell(`${COL.no}${r}`).value = { formula: `IF(${COL.name}${r}="","",ROW()-${FIRST - 1})` };
    }
    if (COL.dob) ws.getCell(`${COL.dob}${r}`).numFmt = "yyyy-mm-dd";
    if (COL.age && COL.dob) {
      // Whole years between DOB and event date in C1 (matches ageOnMatchDay).
      ws.getCell(`${COL.age}${r}`).value = {
        formula: `IFERROR(DATEDIF(${COL.dob}${r},$C$1,"Y"),"")`,
      };
    }
    for (const c of cols) {
      const cell = ws.getCell(`${COL[c.key]}${r}`);
      if (c.computed)       { cell.fill = FILL_COMPUTED; cell.font = { italic: true, color: { argb: "FF64748B" } }; }
      else if (c.required)  { cell.fill = FILL_REQ; }
      else if (r % 2 === 0) { cell.fill = FILL_STRIPE; }
    }
  }

  // ── Data validation per column ─────────────────────────────────────────
  const dvMap = {
    gender:   () => listDV(`=${R.GENDER}`),
    district: () => listDV(`=${R.DISTRICT}`),
    afftype:  () => listDV(`=${R.AFF}`),
    weight:   () => ({ type: "decimal", operator: "between", allowBlank: true, formulae: [20, 250],
                       showErrorMessage: true, errorStyle: "stop",
                       errorTitle: "Weight out of range", error: "Enter a kg value between 20 and 250." }),
    mobile:   () => ({ type: "textLength", operator: "equal", allowBlank: true, formulae: [10],
                       showErrorMessage: true, errorStyle: "stop",
                       errorTitle: "Mobile must be 10 digits", error: "Enter exactly 10 digits, no +91, no spaces." }),
    aadhaar:  () => ({ type: "textLength", operator: "equal", allowBlank: true, formulae: [12],
                       showErrorMessage: true, errorStyle: "stop",
                       errorTitle: "Aadhaar must be 12 digits", error: "Enter exactly 12 digits or leave blank." }),
    dob:      () => ({ type: "date", operator: "between", allowBlank: true,
                       formulae: [new Date(1925, 0, 1), new Date()],
                       showInputMessage: true, promptTitle: "Date of Birth",
                       prompt: "Enter as a date. Recommended format: YYYY-MM-DD (e.g. 2002-06-15).",
                       showErrorMessage: true, errorStyle: "stop",
                       errorTitle: "Invalid date",
                       error: "Enter a valid DOB between 1925-01-01 and today." }),
  };
  if (track === TRACK_NON_PARA) {
    dvMap.ageclass = () => listDV(`=${R.AGECLASS}`);
    dvMap.hand     = () => listDV(`=${R.HAND}`);
    dvMap.compup   = () => listDV(`=${R.YESNO}`);
    dvMap.srhand   = () => listDV(`=${R.HAND}`);
  } else {
    dvMap.para = () => listDV(`=${R.PARA}`);
    dvMap.parahand = () => listDV(`=${R.HAND}`);
  }
  for (const [key, builder] of Object.entries(dvMap)) {
    if (!COL[key]) continue;
    for (let r = FIRST; r <= LAST; r++) {
      ws.getCell(`${COL[key]}${r}`).dataValidation = builder();
    }
  }

  // ── Conditional formatting ────────────────────────────────────────────
  // Required cell turns red when name is filled but cell is empty.
  for (const c of cols.filter((x) => x.required && x.key !== "no" && x.key !== "name")) {
    ws.addConditionalFormatting({
      ref: `${COL[c.key]}${FIRST}:${COL[c.key]}${LAST}`,
      rules: [{
        type: "expression",
        formulae: [`AND($${COL.name}${FIRST}<>"",${COL[c.key]}${FIRST}="")`],
        style: { fill: FILL_RED },
        priority: 1,
      }],
    });
  }
  // District required only when Affiliation = District.
  ws.addConditionalFormatting({
    ref: `${COL.district}${FIRST}:${COL.district}${LAST}`,
    rules: [{
      type: "expression",
      formulae: [`AND($${COL.afftype}${FIRST}="District",${COL.district}${FIRST}="")`],
      style: { fill: FILL_RED },
      priority: 2,
    }],
  });
  // Team required only when Affiliation = Team.
  ws.addConditionalFormatting({
    ref: `${COL.team}${FIRST}:${COL.team}${LAST}`,
    rules: [{
      type: "expression",
      formulae: [`AND($${COL.afftype}${FIRST}="Team",${COL.team}${FIRST}="")`],
      style: { fill: FILL_RED },
      priority: 2,
    }],
  });
  // Senior Hand required only when "Also compete in SENIOR?" = Yes (Non-Para only).
  if (track === TRACK_NON_PARA && COL.srhand && COL.compup) {
    ws.addConditionalFormatting({
      ref: `${COL.srhand}${FIRST}:${COL.srhand}${LAST}`,
      rules: [{
        type: "expression",
        formulae: [`AND($${COL.compup}${FIRST}="Yes",${COL.srhand}${FIRST}="")`],
        style: { fill: FILL_RED },
        priority: 2,
      }],
    });
  }

  // ── Sample row (italic grey) ──────────────────────────────────────────
  const r = FIRST;
  for (const [k, v] of Object.entries(track.sample)) {
    if (v === "" || v === null || v === undefined || !COL[k]) continue;
    const cell = ws.getCell(`${COL[k]}${r}`);
    cell.value = v;
    cell.font = { italic: true, color: { argb: "FF6B7280" } };
  }
  // Pre-fill the event start date (2 May 2026 — TN district competition).
  ws.getCell("C1").value = new Date(Date.UTC(2026, 4, 2));
}

function buildAgeEligibilitySheet(wb) {
  const ws = wb.addWorksheet("Age Eligibility", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 60 }];
  const hdr = ws.addRow(["Age Class", "Min Age", "Max Age", "Notes"]);
  hdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hdr.eachCell((c) => { c.fill = FILL_HDR_OPT; });

  const notes = {
    "SUB-JUNIOR 15": "M+F.",
    "JUNIOR 18": "M+F. May opt-in to SENIOR (compete-up).",
    "YOUTH 23": "M+F.",
    "SENIOR": "M+F. 16-18 only via compete-up opt-in.",
    "MASTER": "M+F.",
    "GRAND MASTER": "M+F.",
    "SENIOR GRAND MASTER": "Men only.",
    "SUPER SENIOR GRAND MASTER": "Men only. OPEN weight bucket only.",
  };
  for (const c of AGE_CLASSES) {
    ws.addRow([c.name, c.min, c.max ?? "+", notes[c.name] ?? ""]).alignment = { vertical: "middle", wrapText: true };
  }
  ws.addRow([]);
  const note = ws.addRow(["Note: Age is calculated on the EVENT START DATE (match-day convention used by this app). Athletes can be eligible for several classes simultaneously (e.g. a 52-year-old male qualifies for SENIOR + MASTER + GRAND MASTER)."]);
  note.font = { italic: true, color: { argb: "FF6B7280" } };
  ws.mergeCells(`A${note.number}:D${note.number}`);
  note.getCell(1).alignment = { wrapText: true };
}

function buildParaClassesSheet(wb) {
  const ws = wb.addWorksheet("Para Classes", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 22 }, { width: 14 }, { width: 60 }];
  const hdr = ws.addRow(["Code", "Posture", "Description"]);
  hdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hdr.eachCell((c) => { c.fill = FILL_HDR_OPT; });
  for (const c of PARA_CLASSES) {
    ws.addRow([c.code, c.posture, c.label]).alignment = { vertical: "middle", wrapText: true };
  }
  ws.addRow([]);
  const note = ws.addRow(["Note: An athlete picks ONE Para Class and ONE Hand. The exact weight bucket is assigned at weigh-in from the Declared Weight."]);
  note.font = { italic: true, color: { argb: "FF6B7280" } };
  ws.mergeCells(`A${note.number}:C${note.number}`);
  note.getCell(1).alignment = { wrapText: true };
}

// ── Main ─────────────────────────────────────────────────────────────────
await buildWorkbook(TRACK_NON_PARA);
await buildWorkbook(TRACK_PARA);
