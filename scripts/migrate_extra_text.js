// Populate Product.extraText from BarTender extractions.
// Targets seasonal markers ("Обечайка X"), marketplace tags ("OZON",
// "ВкусВилл", ...), alt manufacturers, BIO certs, country of origin,
// brand/variant labels. See find_extra_text.js for the empirical analysis
// that led to this pattern set.
//
// Match key: btwFilePath. For each .btw file we scan all type-5 text
// objects, pick those matching the patterns below, join with "; ", and
// write the result to the matching DB row's extraText (overwriting).
// READ-ONLY by default. Pass --apply to write.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const APPLY = process.argv.includes("--apply");

const TXT_FILES = [
  "all_pco.txt", "all_pcb.txt", "all_pcsh.txt",
  "f1_mp.txt", "f2_mp_vesovie.txt", "f3_shk_gya.txt", "shk_only.txt",
].map((f) => path.join(ROOT, "import_runs", f));

// Patterns that should land in extraText. Order matters slightly for
// readability of the joined output (more specific labels first).
//
// NOTE: \b in JS only treats [A-Za-z0-9_] as word characters, so word
// boundaries don't fire correctly around Cyrillic. We use (?:\s|$) or
// explicit anchors instead.
const EXTRA_PATTERNS = [
  // Seasonal wrappers / occasion markers ("Обечайка 8 Марта", "Обечайка Новый год")
  /^обечайка(?:\s|$)/i,
  // Marketplace / retailer tags
  /^(?:OZON|ОЗОН|Mistral|Караван|ВкусВилл|ВКУСВИЛЛ|Wildberries|WB|Магнит|Лента|Перекрёсток|Перекресток)(?:\s|$)/i,
  // Alt manufacturer order ("Изготовленно по заказу ИП/ООО ...") — also matches single-Н spelling
  /^изготов\S*\s+по\s+заказу(?:\s|$)/i,
  // BIO certifications & equivalent
  /^RU-BIO-\d/i,
  /^EU-BIO-\d/i,
  /^(?:Non-EU|EU)\s+Agriculture\s*$/i,
  // Country of origin
  /^Страна\s+происхождения\s*:/i,
  // Variant / brand / packaging-style markers (allowlist of common ones)
  /^Брикет\s*$/i,
  /^Шишка\s+малая(?:\s|$)/i,
  /^Сибирские\s+конфеты\s*$/i,
  /^батоны\s*$/i,
  // Promo / limited-edition
  /^(?:Лимитированн|Limited|Промо|Эксклюзив|Серия\s*:)/i,
  // Multi-pack info ("2 упаковочные единицы по 5 кг")
  /^\d+\s+упаковочн\S*\s+единиц/i,
];

function matchesExtra(val) {
  if (!val) return false;
  if (val.length > 120) return false; // long texts are typically composition
  return EXTRA_PATTERNS.some((re) => re.test(val));
}

// Parse all extractions into { srcPath(lowercase) -> joined extra string }
const srcMap = new Map();
let totalFiles = 0;
let totalExtras = 0;

for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), extras: [] };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue;
      const val = parts.slice(4).join("|").trim();
      if (matchesExtra(val)) cur.extras.push(val);
    } else if (ln === "FILE_END" && cur) {
      totalFiles++;
      if (cur.extras.length > 0) {
        // Dedupe preserving order
        const seen = new Set();
        const unique = cur.extras.filter((v) => {
          const k = v.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        srcMap.set(cur.src.toLowerCase(), unique.join("; "));
        totalExtras += unique.length;
      }
      cur = null;
    }
  }
}

console.log("Scanned " + totalFiles + " files; " + srcMap.size + " have extraText, " + totalExtras + " total extras");

// Map DB btwFilePath → P: path (strip "не используются\" prefix to get P:\ side).
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
const P_BASE = "P:\\Rizograf\\От Салаховой";
function dbToP(dbp) {
  if (!dbp || !dbp.startsWith(DB_PREFIX)) return null;
  let rel = dbp.slice(DB_PREFIX.length);
  if (rel.startsWith("не используются\\")) rel = rel.slice("не используются\\".length);
  return (P_BASE + "\\" + rel).toLowerCase();
}

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db.prepare(`SELECT id, name, sku, btwFilePath, extraText FROM Product WHERE name <> '_folder_marker' AND btwFilePath IS NOT NULL AND btwFilePath <> ''`).all();

const stats = { total: rows.length, matched: 0, same: 0, willChange: 0, noSource: 0 };
const updates = [];
const samples = [];

for (const r of rows) {
  const key = dbToP(r.btwFilePath);
  if (!key || !srcMap.has(key)) { stats.noSource++; continue; }
  stats.matched++;
  const newExtra = srcMap.get(key);
  const cur = r.extraText || null;
  if (cur === newExtra) { stats.same++; continue; }
  stats.willChange++;
  updates.push({ id: r.id, oldVal: cur, newVal: newExtra });
  if (samples.length < 15) samples.push({ sku: r.sku || "-", name: (r.name || "").slice(0, 50), old: cur, new: newExtra });
}

console.log("\n=== STATS ===");
for (const k of Object.keys(stats)) console.log("  " + k + ": " + stats[k]);

console.log("\n=== Sample changes ===");
for (const s of samples) {
  console.log("  • SKU " + s.sku + " — " + s.name);
  console.log("    " + (s.old ? JSON.stringify(s.old) : "(empty)") + " → " + JSON.stringify(s.new));
}

console.log("\n" + (APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write"));
console.log("Planned updates: " + updates.length);

if (APPLY) {
  const upd = db.prepare("UPDATE Product SET extraText = ?, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of updates) upd.run(u.newVal, now, u.id);
  });
  tx();
  console.log("Applied " + updates.length + " UPDATEs.");
}
db.close();
