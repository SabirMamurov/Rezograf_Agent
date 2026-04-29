// Fix F2 names: when current name is a phone, replace with "Текст 4" from source.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const SRC_PREFIX = "P:\\Rizograf\\От Салаховой\\Цех ПЦО\\МП Весовые\\";
const TARGET_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\Цех ПЦО\\МП Весовые\\";

// Read import_runs/f2_mp_vesovie.txt and build map {srcPath: текст4Value}
const raw = fs.readFileSync(path.join(ROOT, "import_runs", "f2_mp_vesovie.txt"), "utf16le");
const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
const lines = stripped.split(/\r?\n/);
const text4 = {};
let cur = null;
for (const ln of lines) {
  if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11) };
  else if (ln.startsWith("OBJ|") && cur) {
    const parts = ln.split("|");
    if (parts[2] && parts[2].trim() === "Текст 4") cur.t4 = parts.slice(4).join("|").trim();
  } else if (ln === "FILE_END") {
    if (cur && cur.t4) text4[cur.src] = cur.t4;
    cur = null;
  }
}

const db = new Database(DB_PATH);
const rows = db.prepare("SELECT id, name, btwFilePath FROM Product WHERE btwFilePath LIKE ?").all(TARGET_PREFIX + "%");
console.log(`F2 rows in DB: ${rows.length}`);

const update = db.prepare("UPDATE Product SET name = ?, updatedAt = ? WHERE id = ?");
const now = new Date().toISOString();
let fixed = 0;

const tx = db.transaction(() => {
  for (const r of rows) {
    const srcPath = SRC_PREFIX + r.btwFilePath.slice(TARGET_PREFIX.length);
    const t4 = text4[srcPath];
    if (!t4) {
      console.log(`  SKIP (no Текст 4 in source): ${r.btwFilePath.split("\\").pop()}`);
      continue;
    }
    // Fix only if current name looks like a phone or address; leave good names alone
    const isBad = /^тел[\.\s:]/i.test(r.name || "") || /област|^\d{6}/.test(r.name || "");
    if (!isBad) {
      console.log(`  KEEP "${r.name}" (looks fine)  ← ${r.btwFilePath.split("\\").pop()}`);
      continue;
    }
    update.run(t4, now, r.id);
    console.log(`  FIX: "${r.name}"  →  "${t4}"`);
    fixed++;
  }
});
tx();
console.log(`\nFixed ${fixed} row(s).`);
db.close();
