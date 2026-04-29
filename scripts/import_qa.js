// QA report on the 214 newly imported products.
const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "prisma", "dev.db"), { readonly: true });

const PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";

const probes = [
  { label: "F1 МП", like: PREFIX + "МП\\%" },
  { label: "F2 МП Весовые", like: PREFIX + "Цех ПЦО\\МП Весовые\\%" },
  // F3: filter to filenames starting with "ШК " or "ШБ " (new arts) at exactly Конфеты\<file>.btw, no deeper
  { label: "F3 ШК ГЯ (only new arts at Конфеты\\ root)", like: PREFIX + "Цех ПЦО\\Конфеты\\Ш% ГЯ %" },
];

for (const p of probes) {
  const rows = db.prepare(`SELECT * FROM Product WHERE btwFilePath LIKE ?`).all(p.like);
  const count = rows.length;
  const filled = (k) => rows.filter((r) => r[k] && String(r[k]).trim().length > 0).length;
  const blanks = ["composition", "weight", "barcodeEan13", "sku", "storageCond", "nutritionalInfo", "manufacturer"];
  console.log(`\n## ${p.label}: ${count} rows`);
  for (const k of blanks) {
    console.log(`   ${k}: filled ${filled(k)}/${count} (${Math.round((filled(k) / count) * 100)}%)`);
  }
  // Names that look bad
  const phoneNames = rows.filter((r) => /^тел[\.\s:]/i.test(r.name || "") || /^\(?[0-9]/.test(r.name || ""));
  const dateNames = rows.filter((r) => /^\d{2}\.\d{2}\.\d{4}$/.test(r.name || ""));
  const veryShort = rows.filter((r) => (r.name || "").trim().length < 5);
  console.log(`   suspicious names: phone-like=${phoneNames.length}, date=${dateNames.length}, too-short=${veryShort.length}`);
  if (phoneNames.length) {
    console.log("   phone-like name examples:");
    for (const r of phoneNames.slice(0, 4))
      console.log(`     • "${r.name}"  ← ${r.btwFilePath.split("\\").pop()}`);
  }
}
