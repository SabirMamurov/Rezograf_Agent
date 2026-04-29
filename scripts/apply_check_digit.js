// Apply check-digit heuristic to barcodes.
// Convention (per company):
//   13 digits + starts with '2' → ITF-14 missing check digit → append → 14 digits
//   12 digits                  → EAN-13 missing check digit → append → 13 digits
//   13 digits + other prefix   → already complete EAN-13 → keep
//   14 digits                  → already complete (ITF-14 if starts with '2', else as-is)
//   8 digits                   → EAN-8 → keep
//   other / empty              → keep
//
// Pass --apply to write. Default = dry-run.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.join(__dirname, "..", "prisma", "dev.db");

function calcEan13Check(c12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(c12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}

// GTIN-14 / ITF-14 check digit. Input: 13 data digits.
// Algorithm: odd positions from LEFT (1,3,5,7,9,11,13) ×3; even positions ×1.
// Equivalent to: from RIGHT, odd positions ×3, even positions ×1.
function calcItf14Check(c13) {
  let s = 0;
  for (let i = 0; i < 13; i++) s += parseInt(c13[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (s % 10)) % 10;
}

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db.prepare("SELECT id, name, sku, barcodeEan13 FROM Product WHERE name <> '_folder_marker'").all();

const stats = {
  total: rows.length,
  noChange_empty: 0,
  noChange_8: 0,
  noChange_13_validEan13: 0,
  noChange_13_other: 0,
  noChange_14: 0,
  changed_12_to_13: 0,
  changed_13_to_14_itf: 0,
  weird_other_length: 0,
};
const updates = [];
const samples = { ean13Append: [], itf14Append: [], skipped13Other: [] };

for (const r of rows) {
  const v = (r.barcodeEan13 || "").trim();
  if (!v) { stats.noChange_empty++; continue; }
  if (!/^\d+$/.test(v)) { stats.weird_other_length++; continue; }

  if (v.length === 12) {
    const c = calcEan13Check(v);
    const newVal = v + c;
    stats.changed_12_to_13++;
    if (samples.ean13Append.length < 6) samples.ean13Append.push({ name: r.name, sku: r.sku, old: v, new: newVal });
    updates.push({ id: r.id, oldVal: v, newVal });
  } else if (v.length === 13) {
    if (v.startsWith("2")) {
      // ITF-14 user-input → append GTIN-14 check
      const c = calcItf14Check(v);
      const newVal = v + c;
      stats.changed_13_to_14_itf++;
      if (samples.itf14Append.length < 6) samples.itf14Append.push({ name: r.name, sku: r.sku, old: v, new: newVal });
      updates.push({ id: r.id, oldVal: v, newVal });
    } else {
      // Already a complete EAN-13 (consumer code)
      // Distinguish valid vs invalid for stats only
      const expected = calcEan13Check(v.substring(0, 12));
      if (expected === parseInt(v[12])) stats.noChange_13_validEan13++;
      else stats.noChange_13_other++;
      if (samples.skipped13Other.length < 4) samples.skipped13Other.push({ name: r.name, sku: r.sku, val: v });
    }
  } else if (v.length === 14) {
    stats.noChange_14++;
  } else if (v.length === 8) {
    stats.noChange_8++;
  } else {
    stats.weird_other_length++;
  }
}

console.log("=== STATS ===");
for (const k of Object.keys(stats)) console.log(`  ${k}: ${stats[k]}`);
console.log(`Total UPDATEs planned: ${updates.length}`);

console.log("\n=== Samples: 12→13 (EAN-13 check appended) ===");
for (const s of samples.ean13Append) console.log(`  • "${s.name}" sku=${s.sku || "-"}  ${s.old} → ${s.new}`);

console.log("\n=== Samples: 13→14 (ITF-14 check appended, prefix '2') ===");
for (const s of samples.itf14Append) console.log(`  • "${s.name}" sku=${s.sku || "-"}  ${s.old} → ${s.new}`);

console.log("\n=== Samples: 13-digit kept as-is (non-'2' prefix) ===");
for (const s of samples.skipped13Other) console.log(`  • "${s.name}" sku=${s.sku || "-"}  ${s.val}`);

console.log(`\n${APPLY ? "APPLY mode" : "DRY-RUN — pass --apply to write"}`);

if (APPLY) {
  const upd = db.prepare("UPDATE Product SET barcodeEan13 = ?, updatedAt = ? WHERE id = ?");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const u of updates) upd.run(u.newVal, now, u.id);
  });
  tx();
  console.log(`Applied ${updates.length} UPDATEs.`);

  const logFile = path.join(__dirname, "..", "import_runs", "checkdigit_updates.json");
  fs.writeFileSync(logFile, JSON.stringify(updates, null, 2));
  console.log(`Update log: ${logFile}`);
}

db.close();
