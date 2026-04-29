// Split the planned 1182 updates into categories.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const RUNS = path.join(ROOT, "import_runs");
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
const P_BASE = "P:\\Rizograf\\От Салаховой";

const TXT_FILES = ["f1_mp.txt", "f2_mp_vesovie.txt", "f3_shk_gya.txt", "all_pco.txt", "all_pcb.txt", "all_pcsh.txt"]
  .map((f) => path.join(RUNS, f));

function calcCheck(c12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(c12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}
function isValidEan13(c) {
  return /^\d{13}$/.test(c) && calcCheck(c.substring(0, 12)) === parseInt(c[12]);
}

function parseDump(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf16le");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), barcodes: [] };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      const value = parts.slice(4).join("|").trim();
      if (type === 4 && value && /^\d+$/.test(value)) cur.barcodes.push(value);
    } else if (ln === "FILE_END") {
      if (cur) out.push(cur);
      cur = null;
    }
  }
  return out;
}

const srcMap = new Map();
for (const f of TXT_FILES) {
  for (const e of parseDump(f)) {
    const bc = e.barcodes[0] || null;
    srcMap.set(e.src.toLowerCase(), bc);
  }
}

function dbToP(dbp) {
  if (!dbp || !dbp.startsWith(DB_PREFIX)) return null;
  let rel = dbp.slice(DB_PREFIX.length);
  if (rel.startsWith("не используются\\")) rel = rel.slice("не используются\\".length);
  return P_BASE + "\\" + rel;
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare("SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE name <> '_folder_marker'").all();

const cats = {
  catA_diffSameLen13: 0,           // both 13 digits, different value (real change)
  catA_diffSameLen14: 0,           // both 14 digits, different value
  catA_diffOther: 0,               // length differs OR other length, value differs

  catB_db13_src12_dataMatches: 0,  // DB 13 digits valid, src 12 = first-12 of DB (cosmetic, no print change)
  catB_other: 0,                    // other length-only or weird mismatches

  // After update breakdown for digits we'd write
  willRender_validEan13: 0,
  willRender_customEan13_nonstd: 0,
  willRender_itf14: 0,
  willRender_other: 0,

  empty_in_db: 0,
  empty_in_src: 0,
};

const samples = { catA13: [], catA14: [], catAOther: [], catBdataMatch: [], catBOther: [] };

for (const r of rows) {
  if (!r.btwFilePath) continue;
  const pPath = dbToP(r.btwFilePath);
  if (!pPath) continue;
  if (!srcMap.has(pPath.toLowerCase())) continue;
  const src = srcMap.get(pPath.toLowerCase());
  const dbBC = (r.barcodeEan13 || "").trim();
  if (!src) { stats_count(cats, "empty_in_src"); continue; }
  if (dbBC === src) continue; // no change

  // Categorize
  if (dbBC.length === src.length) {
    if (src.length === 13) {
      cats.catA_diffSameLen13++;
      if (samples.catA13.length < 5) samples.catA13.push({ name: r.name, dbBC, src, srcValid: isValidEan13(src) });
    } else if (src.length === 14) {
      cats.catA_diffSameLen14++;
      if (samples.catA14.length < 3) samples.catA14.push({ name: r.name, dbBC, src });
    } else {
      cats.catA_diffOther++;
      if (samples.catAOther.length < 3) samples.catAOther.push({ name: r.name, dbBC, src });
    }
  } else if (dbBC.length === 13 && src.length === 12 && dbBC.startsWith(src) && isValidEan13(dbBC)) {
    cats.catB_db13_src12_dataMatches++;
    if (samples.catBdataMatch.length < 4) samples.catBdataMatch.push({ name: r.name, dbBC, src });
  } else {
    cats.catB_other++;
    if (samples.catBOther.length < 4) samples.catBOther.push({ name: r.name, dbBC, src });
  }

  // What renderer would do AFTER updating to src
  if (/^\d{14}$/.test(src) && src.startsWith("2")) cats.willRender_itf14++;
  else if (/^\d{13}$/.test(src)) {
    if (calcCheck(src.substring(0, 12)) === parseInt(src[12])) cats.willRender_validEan13++;
    else cats.willRender_customEan13_nonstd++;
  } else if (/^\d{12}$/.test(src)) cats.willRender_validEan13++; // 12 → renderer adds check, EAN-13
  else cats.willRender_other++;
}

function stats_count(o, k) { o[k] = (o[k] || 0) + 1; }

console.log("\n=== CATEGORIES OF DIFFS ===");
console.log(`A. Real digit changes (same length):`);
console.log(`     A1. 13 → 13 different: ${cats.catA_diffSameLen13}`);
console.log(`     A2. 14 → 14 different: ${cats.catA_diffSameLen14}`);
console.log(`     A3. other length, both same: ${cats.catA_diffOther}`);
console.log(`B. Length differences (mostly cosmetic):`);
console.log(`     B1. DB 13-digit valid EAN-13, src 12 = first-12 of DB: ${cats.catB_db13_src12_dataMatches}`);
console.log(`     B2. other length differences: ${cats.catB_other}`);

console.log(`\n=== After UPDATE — what renderer will use ===`);
console.log(`  bwip-js EAN-13 (valid check): ${cats.willRender_validEan13}`);
console.log(`  custom EAN-13 (non-standard check, my new code): ${cats.willRender_customEan13_nonstd}`);
console.log(`  ITF-14 (14-digit starting with 2): ${cats.willRender_itf14}`);
console.log(`  other / Code128 fallback: ${cats.willRender_other}`);

console.log("\n=== Samples A1 (13→13 different) ===");
for (const s of samples.catA13) console.log(`  • ${s.name}: ${s.dbBC} → ${s.src}  ${s.srcValid ? "(src is valid EAN-13)" : "(src non-standard EAN-13)"}`);
console.log("\n=== Samples A2 (14→14 different) ===");
for (const s of samples.catA14) console.log(`  • ${s.name}: ${s.dbBC} → ${s.src}`);
console.log("\n=== Samples A3 (other length, same length) ===");
for (const s of samples.catAOther) console.log(`  • ${s.name}: ${s.dbBC} → ${s.src}`);
console.log("\n=== Samples B1 (cosmetic 13→12) ===");
for (const s of samples.catBdataMatch) console.log(`  • ${s.name}: ${s.dbBC} → ${s.src}`);
console.log("\n=== Samples B2 (other length diffs) ===");
for (const s of samples.catBOther) console.log(`  • ${s.name}: ${s.dbBC} → ${s.src}`);
