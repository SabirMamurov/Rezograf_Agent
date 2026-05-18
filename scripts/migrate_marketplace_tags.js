// Populate Product.extraText with marketplace/customer tags from BarTender
// extractions. Narrow allowlist (variant C): only marketplace and customer
// names — no variant markers in parens, no promo flags, no flavor words.
//
// READ-ONLY by default. Pass --apply to write.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const TXT_FILES = ["all_pco.txt","all_pcb.txt","all_pcsh.txt","f1_mp.txt","f2_mp_vesovie.txt","f3_shk_gya.txt","shk_only.txt"]
  .map((f) => path.join(ROOT, "import_runs", f));

// Marketplace / customer tag allowlist. Case-insensitive match against the
// raw Текст N value (after .trim()). Stored value keeps the original case
// from the .btw file.
const MARKETPLACE_PATTERNS = [
  // 2-letter abbreviations the operator stamps on small-print labels
  /^М[ПШ]$/,                                              // МП, МШ
  /^EPSILON$/i,
  /^ГРИФОН$/i,
  /^Russian\s+Puzzle$/i,
  /^АСЭ\s*\(Росатом\)$/i,
  /^Сандун[ыа]\.?$/i,                                     // Сандуны / САНДУНЫ
  /^Тюмень\.?$/i,
  /^Кемерово\.?$/i,
  /^Н\.\s*Новгород\.?$/i,
  /^С-ПЕТЕРБУРГ\.?$/i,
  /^Томскнефтепродукт\s+ВНК$/i,
  /^Томскэнергосбыт$/i,
  /^Лайма$/i,
  /^Новосибирскхлебпродукт$/i,
  /^Югорские\s+традиции$/i,
  /^Российский\s+Футбольный\s+СОЮЗ$/i,
  /^Славда$/i,
  /^ХМАО$/i,
  /^Ассоциация\s+Акушеров\s+Гинекологов$/i,
  /^Сибирские\s+конфеты$/i,
  /^Мёд?\s*"Таёжный"$/i,
];

function isMarketplaceTag(val) {
  if (!val) return false;
  for (const re of MARKETPLACE_PATTERNS) if (re.test(val)) return true;
  return false;
}

// Build map: basename(lowercase) → marketplace tag found in .btw
const sourceByBase = new Map();
for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0)===0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), tag: null };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue;
      const val = parts.slice(4).join("|").trim();
      if (!cur.tag && isMarketplaceTag(val)) cur.tag = val;
    } else if (ln === "FILE_END" && cur) {
      if (cur.tag) {
        const base = cur.src.split("\\").pop().toLowerCase();
        // If two extraction files yield different tags for the same basename
        // (shouldn't happen in practice — same file = same content), keep first.
        if (!sourceByBase.has(base)) sourceByBase.set(base, cur.tag);
      }
      cur = null;
    }
  }
}
console.log("Source .btw files with marketplace tag: " + sourceByBase.size);
const distinct = new Set([...sourceByBase.values()].map((v) => v.toLowerCase()));
console.log("Distinct tags found: " + distinct.size);
const tagCounts = new Map();
for (const v of sourceByBase.values()) tagCounts.set(v, (tagCounts.get(v) || 0) + 1);
console.log("\n=== Tag distribution ===");
for (const [k, n] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  [" + n + "x] " + JSON.stringify(k));
}

// Match DB by basename
const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db
  .prepare("SELECT id, name, sku, btwFilePath, extraText FROM Product WHERE name <> '_folder_marker' AND btwFilePath IS NOT NULL")
  .all();

const toSet = [];
const alreadyHas = [];
const overwriteSkipped = [];
const samples = [];

for (const r of rows) {
  const base = r.btwFilePath.split("\\").pop().toLowerCase();
  const tag = sourceByBase.get(base);
  if (!tag) continue;

  const existing = (r.extraText || "").trim();
  if (!existing) {
    toSet.push({ id: r.id, tag });
    if (samples.length < 12) samples.push({ sku: r.sku || "-", name: r.name.slice(0, 50), tag });
    continue;
  }
  // Already contains the same tag? Skip silently.
  if (existing.toLowerCase().includes(tag.toLowerCase())) {
    alreadyHas.push(r.id);
    continue;
  }
  // Already has something else — DON'T overwrite (operator may have customized).
  overwriteSkipped.push({ id: r.id, existing, tag, sku: r.sku });
}

console.log("\n=== STATS ===");
console.log("  to set extraText: " + toSet.length);
console.log("  already has the same tag: " + alreadyHas.length);
console.log("  already has DIFFERENT text (skipping to not overwrite): " + overwriteSkipped.length);

console.log("\n=== Sample updates ===");
for (const s of samples) console.log("  SKU " + s.sku + "  " + JSON.stringify(s.name) + "  → extraText = " + JSON.stringify(s.tag));

if (overwriteSkipped.length > 0) {
  console.log("\n=== Sample skip-overwrite (left as is) ===");
  for (const s of overwriteSkipped.slice(0, 6)) {
    console.log("  SKU " + (s.sku||"-") + "  existing=" + JSON.stringify(s.existing).slice(0, 50) + "  would-set=" + JSON.stringify(s.tag));
  }
}

console.log("\n" + (APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write"));
if (APPLY) {
  const upd = db.prepare("UPDATE Product SET extraText = ?, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of toSet) upd.run(u.tag, now, u.id);
  });
  tx();
  console.log("Applied " + toSet.length + " UPDATEs.");
}
db.close();
