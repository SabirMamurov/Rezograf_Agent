// Compare current DB barcodes against fresh BarTender extracts and apply updates.
// READ-ONLY by default — pass --apply to actually UPDATE.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const RUNS = path.join(ROOT, "import_runs");
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
const P_BASE = "P:\\Rizograf\\От Салаховой";
const APPLY = process.argv.includes("--apply");

// All extraction outputs we have. Each emits FILE_START=<P-path> blocks.
const TXT_FILES = [
  "f1_mp.txt",
  "f2_mp_vesovie.txt",
  "f3_shk_gya.txt",
  "all_pco.txt",
  "all_pcb.txt",
  "all_pcsh.txt",
].map((f) => path.join(RUNS, f));

function parseDump(file) {
  if (!fs.existsSync(file)) {
    console.warn(`  ! missing: ${path.basename(file)} (skipped)`);
    return [];
  }
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

// Build map: lowercased P-path → first numeric barcode found (or null)
const srcMap = new Map();
let dupes = 0;
for (const f of TXT_FILES) {
  const entries = parseDump(f);
  console.log(`Loaded ${entries.length} from ${path.basename(f)}`);
  for (const e of entries) {
    const key = e.src.toLowerCase();
    const bc = e.barcodes[0] || null; // first barcode object value
    if (srcMap.has(key) && srcMap.get(key) !== bc) dupes++;
    srcMap.set(key, bc);
  }
}
console.log(`Total unique source paths: ${srcMap.size}  (conflicting dupes: ${dupes})`);

// Map DB btwFilePath → candidate P path. Strip DB_PREFIX, strip "не используются\" prefix
// if present, then prepend P_BASE. We do not case-correct here — lookups are case-insensitive.
function dbToP(dbp) {
  if (!dbp || !dbp.startsWith(DB_PREFIX)) return null;
  let rel = dbp.slice(DB_PREFIX.length);
  if (rel.startsWith("не используются\\")) rel = rel.slice("не используются\\".length);
  return P_BASE + "\\" + rel;
}

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db
  .prepare("SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE name <> '_folder_marker'")
  .all();

const stats = {
  total: rows.length,
  noBtwPath: 0,
  noPMatch: 0, // file in DB not found in any extraction
  srcEmpty: 0, // file found but BarTender returned no barcode object
  same: 0,
  diff: 0,
  fillFromEmpty: 0, // DB had empty, source has value
  clearToEmpty: 0, // DB had value, source has none — RARE, we don't blank out unless explicitly asked
};
const updates = [];
const sampleDiff = [];
const sampleNoMatch = [];
const sampleSrcEmpty = [];
const sampleFill = [];

for (const r of rows) {
  if (!r.btwFilePath) { stats.noBtwPath++; continue; }
  const pPath = dbToP(r.btwFilePath);
  if (!pPath) { stats.noBtwPath++; continue; }
  if (!srcMap.has(pPath.toLowerCase())) {
    stats.noPMatch++;
    if (sampleNoMatch.length < 8) sampleNoMatch.push({ db: r.btwFilePath, p: pPath });
    continue;
  }
  const src = srcMap.get(pPath.toLowerCase());
  const dbBC = (r.barcodeEan13 || "").trim();

  if (!src) {
    stats.srcEmpty++;
    if (sampleSrcEmpty.length < 6 && dbBC) sampleSrcEmpty.push({ name: r.name, dbBC, p: pPath });
    continue;
  }
  if (dbBC === src) { stats.same++; continue; }
  stats.diff++;
  if (!dbBC) stats.fillFromEmpty++;
  if (sampleDiff.length < 25)
    sampleDiff.push({ id: r.id, name: r.name, sku: r.sku, dbBC: dbBC || "(empty)", src, file: r.btwFilePath.split("\\").pop() });
  if (!dbBC && sampleFill.length < 8) sampleFill.push({ name: r.name, src, file: r.btwFilePath.split("\\").pop() });
  updates.push({ id: r.id, oldVal: dbBC || null, newVal: src });
}

console.log("\n=== STATS ===");
for (const k of Object.keys(stats)) console.log(`  ${k}: ${stats[k]}`);

console.log("\n=== Sample diffs (DB → source) ===");
for (const s of sampleDiff) {
  const tag = s.dbBC === "(empty)" ? "  [filling empty]" : "";
  console.log(`  • "${s.name}" sku=${s.sku || "-"}  ${s.dbBC} → ${s.src}${tag}`);
  console.log(`    file: ${s.file}`);
}

if (sampleNoMatch.length) {
  console.log("\n=== Sample DB rows whose .btw not found in any extraction ===");
  for (const s of sampleNoMatch) console.log(`  • ${s.db}\n      → expected on P: ${s.p}`);
}

if (sampleSrcEmpty.length) {
  console.log("\n=== Sample: DB has barcode but BarTender returned no barcode object ===");
  for (const s of sampleSrcEmpty) console.log(`  • "${s.name}" dbBC=${s.dbBC}\n      ${s.p}`);
}

console.log(`\n${APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write changes"}`);
console.log(`Planned updates: ${updates.length}`);

if (APPLY) {
  const upd = db.prepare("UPDATE Product SET barcodeEan13 = ?, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of updates) upd.run(u.newVal, now, u.id);
  });
  tx();
  console.log(`Applied ${updates.length} UPDATEs.`);

  // Save a log so we can roll back if needed
  const logFile = path.join(ROOT, "import_runs", "barcode_updates.json");
  fs.writeFileSync(logFile, JSON.stringify(updates, null, 2));
  console.log(`Update log saved to ${logFile} (use to roll back per-row if needed).`);
}

db.close();
