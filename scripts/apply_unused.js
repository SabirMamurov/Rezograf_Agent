// Apply: move stale products into a "не используются" virtual folder by
// prepending "не используются\" to the path component after DB_PREFIX.
// Reads ids from stale_ids.json (produced by dry_run_unused.js).

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "prisma", "dev.db");
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
const UNUSED_FOLDER = "не используются";

const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "stale_ids.json"), "utf8")).ids;
console.log(`Loaded ${ids.length} stale product ids from stale_ids.json`);

const db = new Database(DB_PATH);
const select = db.prepare("SELECT id, btwFilePath FROM Product WHERE id = ?");
const update = db.prepare("UPDATE Product SET btwFilePath = ? WHERE id = ?");

const tx = db.transaction((ids) => {
  let updated = 0;
  let skippedAlready = 0;
  let skippedShape = 0;
  for (const id of ids) {
    const row = select.get(id);
    if (!row || !row.btwFilePath) {
      skippedShape++;
      continue;
    }
    if (!row.btwFilePath.startsWith(DB_PREFIX)) {
      skippedShape++;
      continue;
    }
    const rel = row.btwFilePath.slice(DB_PREFIX.length);
    if (rel.startsWith(UNUSED_FOLDER + "\\")) {
      skippedAlready++;
      continue;
    }
    const next = DB_PREFIX + UNUSED_FOLDER + "\\" + rel;
    update.run(next, id);
    updated++;
  }
  return { updated, skippedAlready, skippedShape };
});

const before = db
  .prepare(
    `SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?`
  )
  .get(DB_PREFIX + UNUSED_FOLDER + "\\%").n;
console.log(`Before: products already under "${UNUSED_FOLDER}": ${before}`);

const r = tx(ids);
console.log(`Updated   : ${r.updated}`);
console.log(`Skipped (already in folder): ${r.skippedAlready}`);
console.log(`Skipped (unexpected shape) : ${r.skippedShape}`);

const after = db
  .prepare(`SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?`)
  .get(DB_PREFIX + UNUSED_FOLDER + "\\%").n;
console.log(`After : products under "${UNUSED_FOLDER}": ${after}`);

// Per-workshop verification: how many products still in each workshop root
for (const w of ["Цех ПЦО", "ЦЕХ ПЦШ", "Цех ПЦБ"]) {
  const stillThere = db
    .prepare(`SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?`)
    .get(DB_PREFIX + w + "\\%").n;
  const movedHere = db
    .prepare(`SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?`)
    .get(DB_PREFIX + UNUSED_FOLDER + "\\" + w + "\\%").n;
  console.log(`  ${w}: still in workshop = ${stillThere}, moved into "${UNUSED_FOLDER}\\${w}" = ${movedHere}`);
}

db.close();
