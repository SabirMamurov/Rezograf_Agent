const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "prisma", "dev.db"), { readonly: true });

const PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";

// Patterns to look for in btwFilePath (case-insensitive substring)
const probes = [
  { label: "anywhere with 'МП Весовые'", sql: "SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%МП Весовые%' COLLATE NOCASE" },
  { label: "anywhere with 'ШК ГЯ новые артикулы'", sql: "SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%ШК ГЯ новые артикулы%' COLLATE NOCASE" },
  { label: "top-level 'МП' folder", sql: `SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '${PREFIX.replace(/\\/g, "\\\\")}МП\\\\%'` },
  { label: "any 'МП\\ПЦО' (folder 1 subtree)", sql: "SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%\\\\МП\\\\ПЦО\\\\%'" },
  { label: "any 'МП\\ПЦБ'", sql: "SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%\\\\МП\\\\ПЦБ\\\\%'" },
  { label: "anywhere under 'Шоу бокс Редизайн' (folder 3 parent path)", sql: "SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%Шоу бокс Редизайн%' COLLATE NOCASE" },
];

for (const p of probes) {
  const rows = db.prepare(p.sql).all();
  console.log(`\n${p.label}: ${rows.length} rows`);
  for (const r of rows.slice(0, 8)) console.log("  -", r.btwFilePath);
  if (rows.length > 8) console.log(`  ... (${rows.length - 8} more)`);
}
