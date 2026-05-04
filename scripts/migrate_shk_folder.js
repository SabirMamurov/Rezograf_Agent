// Move 37 ШК products into virtual subfolder \ШБ ТУЛА\ШК\, populate
// name (Текст 3) and weight (Текст 4 — subtitle "(шоу-бокс/585 г)").
// READ-ONLY by default. Pass --apply to write.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const TXT = path.join(ROOT, "import_runs", "shk_only.txt");
const APPLY = process.argv.includes("--apply");

const PARENT_DIR = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\Цех ПЦО\\Конфеты\\Конфеты\\Шоу-боксы\\Шоу бокс Редизайн с Апрель 2022\\ШБ ТУЛА\\";
const NEW_DIR = PARENT_DIR + "ШК\\";

// Parse extraction
const raw = fs.readFileSync(TXT, "utf16le");
const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
const lines = stripped.split(/\r?\n/);

const sources = {}; // basename(lowercase) -> { title, subtitle, barcode, srcPath }
let cur = null;
for (const ln of lines) {
  if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), objs: [] };
  else if (ln.startsWith("OBJ|") && cur) {
    const parts = ln.split("|");
    cur.objs.push({ name: (parts[2] || "").trim(), type: parseInt(parts[3]) || 0, value: parts.slice(4).join("|").trim() });
  } else if (ln === "FILE_END" && cur) {
    const t3 = cur.objs.find((o) => o.name === "Текст 3" && o.type === 5);
    const t4 = cur.objs.find((o) => o.name === "Текст 4" && o.type === 5);
    const bc = cur.objs.find((o) => o.type === 4 && /^\d+$/.test(o.value));
    const base = cur.src.split("\\").pop().toLowerCase();
    sources[base] = {
      srcPath: cur.src,
      title: t3 ? t3.value : "",
      subtitle: t4 ? t4.value : "",
      barcode: bc ? bc.value : "",
    };
    cur = null;
  }
}
console.log("Parsed " + Object.keys(sources).length + " source files");

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db.prepare(`SELECT id, name, sku, weight, barcodeEan13, btwFilePath FROM Product WHERE btwFilePath LIKE ? AND name <> '_folder_marker'`).all(PARENT_DIR + "%");

console.log("DB rows under ШБ ТУЛА: " + rows.length);

// We only target rows whose basename starts with "ШК " (and isn't already in ШК\ subfolder)
const targets = rows.filter((r) => {
  const tail = r.btwFilePath.slice(PARENT_DIR.length);
  if (tail.includes("\\")) return false; // already in a subfolder
  return /^ШК\s/i.test(tail);
});
console.log("Direct under ШБ ТУЛА starting with 'ШК ': " + targets.length);

const updates = [];
const sampleNoMatch = [];
const samples = [];

for (const r of targets) {
  const base = r.btwFilePath.split("\\").pop().toLowerCase();
  const src = sources[base];
  if (!src) {
    sampleNoMatch.push({ db: r.btwFilePath });
    continue;
  }
  const newPath = NEW_DIR + r.btwFilePath.split("\\").pop();
  const newName = src.title || r.name;
  const newWeight = src.subtitle || null;
  // Don't change barcode here — already synced via collision fix.
  updates.push({ id: r.id, oldPath: r.btwFilePath, newPath, newName, newWeight });
  if (samples.length < 5) samples.push({ id: r.id, name: r.name, newName, newWeight, newPath });
}

console.log("Planned updates: " + updates.length);
console.log("No source-file match: " + sampleNoMatch.length);
for (const s of sampleNoMatch.slice(0, 5)) console.log("  ! no match: " + s.db);

console.log("\n=== Sample updates ===");
for (const s of samples) {
  console.log("• name: " + JSON.stringify(s.name) + " → " + JSON.stringify(s.newName));
  console.log("  weight: → " + JSON.stringify(s.newWeight));
  console.log("  path → " + s.newPath);
}

console.log("\n" + (APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write"));
if (APPLY) {
  const upd = db.prepare("UPDATE Product SET btwFilePath = ?, name = ?, weight = ?, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of updates) upd.run(u.newPath, u.newName, u.newWeight, now, u.id);
  });
  tx();
  console.log("Applied " + updates.length + " UPDATEs.");
}
db.close();
