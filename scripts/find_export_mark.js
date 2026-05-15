// Scan BarTender extractions for the "Э" export mark.
// Reports unique product files with the mark and which Text objects hold it.
const fs = require("fs");
const path = require("path");

const TXT_FILES = [
  "all_pco.txt",
  "all_pcb.txt",
  "all_pcsh.txt",
  "f1_mp.txt",
  "f2_mp_vesovie.txt",
  "f3_shk_gya.txt",
  "shk_only.txt",
].map((f) => path.join(__dirname, "..", "import_runs", f));

const filesWithMark = new Set();
const byObjName = new Map();
const samples = [];

for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), hits: [] };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue;
      const objName = (parts[2] || "").trim();
      const val = parts.slice(4).join("|").trim();
      // Strict match: just "Э" (the single Cyrillic letter), possibly with whitespace
      if (val === "Э" || /^Э\s*$/.test(val)) {
        cur.hits.push(objName);
      }
    } else if (ln === "FILE_END" && cur) {
      if (cur.hits.length > 0) {
        filesWithMark.add(cur.src);
        for (const o of cur.hits) byObjName.set(o, (byObjName.get(o) || 0) + 1);
        if (samples.length < 12) samples.push({ src: cur.src, hits: cur.hits });
      }
      cur = null;
    }
  }
}

console.log("Files with 'Э' mark: " + filesWithMark.size);
console.log("\nBy Text-object number (where the mark lives):");
const sortedObj = [...byObjName.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of sortedObj) console.log("  " + k + ": " + v + " occurrences");

console.log("\nSample files (first 12):");
for (const s of samples) {
  console.log("  • " + s.src.split("\\").slice(-3).join("\\") + "  [hits: " + s.hits.join(", ") + "]");
}

// Categorize by top-level folder (Цех ПЦО / Цех ПЦБ / ЦЕХ ПЦШ / МП etc.)
const byTop = new Map();
for (const src of filesWithMark) {
  const rel = src.replace(/^P:\\Rizograf\\От Салаховой\\/i, "");
  const top = rel.split("\\")[0];
  byTop.set(top, (byTop.get(top) || 0) + 1);
}
console.log("\nBy top-level folder:");
for (const [k, v] of [...byTop.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + k + ": " + v);
}

// Match against DB products (heuristic: by basename match)
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "prisma", "dev.db"), { readonly: true });

// Build map of basename -> array of DB rows
const baseToRows = new Map();
const allRows = db.prepare("SELECT id, name, sku, btwFilePath FROM Product WHERE name <> '_folder_marker' AND btwFilePath IS NOT NULL").all();
for (const r of allRows) {
  const base = r.btwFilePath.split("\\").pop();
  if (!baseToRows.has(base)) baseToRows.set(base, []);
  baseToRows.get(base).push(r);
}

let dbMatched = 0;
let dbMissing = 0;
const dbSamples = [];
for (const src of filesWithMark) {
  const base = src.split("\\").pop();
  const rows = baseToRows.get(base);
  if (rows && rows.length > 0) {
    dbMatched += rows.length;
    if (dbSamples.length < 8) dbSamples.push({ src: base, count: rows.length, name: rows[0].name.slice(0, 60), sku: rows[0].sku });
  } else {
    dbMissing++;
  }
}
console.log("\n=== DB match (basename) ===");
console.log("DB rows that need isExport=true: " + dbMatched);
console.log("Source files with no DB match (deleted/renamed): " + dbMissing);
console.log("\nSample DB rows:");
for (const s of dbSamples) {
  console.log("  • SKU " + (s.sku || "-") + " " + JSON.stringify(s.name) + "  [" + s.count + " rows]  ← " + s.src);
}
