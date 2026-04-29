// Pick 3 products per category for user spot-check.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const UPDATES = JSON.parse(fs.readFileSync(path.join(ROOT, "import_runs", "checkdigit_updates.json"), "utf8"));

const db = new Database(DB_PATH, { readonly: true });

const updateById = new Map();
for (const u of UPDATES) updateById.set(u.id, u);

const get = (id) => db.prepare("SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE id = ?").get(id);

function fmt(r, oldVal) {
  const file = r.btwFilePath ? r.btwFilePath.split("\\").pop() : "(no file)";
  const oldStr = oldVal ? `BarTender: ${oldVal} → ` : "";
  return `  • "${r.name}" sku=${r.sku || "-"}\n      ${oldStr}В БД: ${r.barcodeEan13}\n      Файл: ${file}`;
}

// Helper to gather diverse samples (skip dups by name+barcode)
function pick(rows, limit, getKey = (r) => r.name + "|" + r.barcodeEan13) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = getKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// 12 → 13 EAN-13 (ones whose oldVal was 12 digits)
const grp12to13 = UPDATES.filter((u) => u.oldVal && u.oldVal.length === 12);
console.log("=== 12 → 13 (EAN-13 check добавлен) — всего: " + grp12to13.length + " ===");
const sample1 = pick(grp12to13.map((u) => ({ ...get(u.id), _old: u.oldVal })), 3);
for (const r of sample1) console.log(fmt(r, r._old));

// 13 → 14 ITF-14 (oldVal 13 digits starting with '2')
const grp13to14 = UPDATES.filter((u) => u.oldVal && u.oldVal.length === 13 && u.oldVal.startsWith("2"));
console.log("\n=== 13 → 14 (ITF-14 check добавлен, префикс '2') — всего: " + grp13to14.length + " ===");
const sample2 = pick(grp13to14.map((u) => ({ ...get(u.id), _old: u.oldVal })), 3);
for (const r of sample2) console.log(fmt(r, r._old));

// 13-digit kept as-is (not starting with '2'). EXCLUDE products that were
// updated by the heuristic (those changed length, so their original wasn't 13).
console.log("\n=== 13-значные, оставлены как EAN-13 (не с '2') — всего: 162 ===");
const updatedIds = new Set(UPDATES.map((u) => u.id));
const grp13kept = db
  .prepare(
    "SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE LENGTH(barcodeEan13) = 13 AND substr(barcodeEan13, 1, 1) <> '2' AND name <> '_folder_marker'"
  )
  .all()
  .filter((r) => !updatedIds.has(r.id));
const sample3 = pick(grp13kept, 3);
for (const r of sample3) console.log(fmt(r, null));

// 14-digit already complete
console.log("\n=== 14-значные (уже полные ITF-14) — всего: 398 ===");
const grp14 = db
  .prepare(
    "SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE LENGTH(barcodeEan13) = 14 AND name <> '_folder_marker'"
  )
  .all();
// Filter out ones that came from heuristic (those have a record in updates with new len 14)
const heurIds = new Set(UPDATES.filter((u) => u.newVal && u.newVal.length === 14).map((u) => u.id));
const grp14pure = grp14.filter((r) => !heurIds.has(r.id));
console.log("(было 14 и до синхронизации, не результат эвристики: " + grp14pure.length + ")");
const sample4 = pick(grp14pure, 3);
for (const r of sample4) console.log(fmt(r, null));
