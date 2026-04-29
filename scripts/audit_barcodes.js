// Audit barcodes in local dev.db: length distribution + EAN-13 check-digit validity.
const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "prisma", "dev.db"), { readonly: true });

function calcEan13Check(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(code12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

const rows = db.prepare("SELECT id, name, sku, barcodeEan13, btwFilePath FROM Product WHERE name <> '_folder_marker'").all();
console.log("Total products (excluding folder markers):", rows.length);

const buckets = {};
const empty = [];
const bad13 = []; // 13-digit but check-digit doesn't validate
const len12 = [];
const len14_starts2 = [];
const len14_other = [];
const lenOther = [];

for (const r of rows) {
  const v = (r.barcodeEan13 || "").trim();
  if (!v) { empty.push(r); continue; }
  const len = v.length;
  buckets[len] = (buckets[len] || 0) + 1;
  if (!/^\d+$/.test(v)) { lenOther.push(r); continue; }
  if (len === 13) {
    const expected = calcEan13Check(v.substring(0, 12));
    const actual = parseInt(v[12]);
    if (expected !== actual) bad13.push({ ...r, expected, actual });
  } else if (len === 12) {
    len12.push(r);
  } else if (len === 14) {
    if (v.startsWith("2")) len14_starts2.push(r);
    else len14_other.push(r);
  } else if (len !== 8) {
    lenOther.push(r);
  }
}

console.log("\nLength distribution:");
for (const k of Object.keys(buckets).sort((a, b) => Number(a) - Number(b))) {
  console.log("  " + k + " digits: " + buckets[k]);
}
console.log("  empty/null: " + empty.length);

console.log("\nIssue summary:");
console.log("  ⚠ 12-digit (probably missing check digit): " + len12.length);
console.log("  ⚠ 13-digit with INVALID EAN-13 check digit: " + bad13.length);
console.log("  ✓ 14-digit starting with '2' (ITF-14): " + len14_starts2.length);
console.log("  ⚠ 14-digit other: " + len14_other.length);
console.log("  ⚠ length other / non-numeric: " + lenOther.length);
console.log("  empty: " + empty.length);

// Samples
function sample(arr, k = 8) {
  console.log("\nSamples:");
  for (const r of arr.slice(0, k)) {
    const tag = r.expected !== undefined ? `  expected check=${r.expected}, got ${r.actual}` : "";
    console.log(`  • "${r.name}"  sku=${r.sku || "-"}  barcode="${r.barcodeEan13 || "-"}"${tag}`);
    console.log(`    ${r.btwFilePath}`);
  }
}

console.log("\n=== 12-digit examples (last digit missing?) ===");
sample(len12);

console.log("\n=== 13-digit with WRONG EAN-13 check digit ===");
sample(bad13);

console.log("\n=== other length / non-numeric ===");
sample(lenOther);
