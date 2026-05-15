// Set isExport=true for every Product whose .btw file has a standalone
// "Э" text object (the export watermark). Match by basename across all
// BarTender extraction dumps in import_runs/.
// READ-ONLY by default. Pass --apply to write.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.join(__dirname, "..", "prisma", "dev.db");
const TXT_FILES = [
  "all_pco.txt",
  "all_pcb.txt",
  "all_pcsh.txt",
  "f1_mp.txt",
  "f2_mp_vesovie.txt",
  "f3_shk_gya.txt",
  "shk_only.txt",
].map((f) => path.join(__dirname, "..", "import_runs", f));

// Build a set of basenames (lowercased) whose .btw contains a "Э" text object.
const exportBasenames = new Set();
for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), hasMark: false };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue;
      const val = parts.slice(4).join("|").trim();
      if (val === "Э" || /^Э\s*$/.test(val)) cur.hasMark = true;
    } else if (ln === "FILE_END" && cur) {
      if (cur.hasMark) {
        const base = cur.src.split("\\").pop().toLowerCase();
        exportBasenames.add(base);
      }
      cur = null;
    }
  }
}
console.log("Source .btw files with 'Э' mark: " + exportBasenames.size);

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db
  .prepare("SELECT id, name, sku, btwFilePath, isExport FROM Product WHERE name <> '_folder_marker' AND btwFilePath IS NOT NULL")
  .all();

const toSetTrue = [];
const alreadyTrue = [];
const samples = [];
for (const r of rows) {
  const base = r.btwFilePath.split("\\").pop().toLowerCase();
  if (!exportBasenames.has(base)) continue;
  if (r.isExport) {
    alreadyTrue.push(r.id);
    continue;
  }
  toSetTrue.push(r.id);
  if (samples.length < 10)
    samples.push({ sku: r.sku || "-", name: r.name.slice(0, 60), file: r.btwFilePath.split("\\").pop() });
}

console.log("Rows already isExport=true: " + alreadyTrue.length);
console.log("Rows that would be set to true: " + toSetTrue.length);

console.log("\n=== Sample (first 10) ===");
for (const s of samples) console.log("  • SKU " + s.sku + " " + JSON.stringify(s.name) + "  ← " + s.file);

console.log("\n" + (APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write"));
if (APPLY) {
  const upd = db.prepare("UPDATE Product SET isExport = 1, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const id of toSetTrue) upd.run(now, id);
  });
  tx();
  console.log("Applied " + toSetTrue.length + " UPDATEs.");
}
db.close();
