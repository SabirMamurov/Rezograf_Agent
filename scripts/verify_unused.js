const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "prisma", "dev.db"), { readonly: true });

const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";

const total = db.prepare("SELECT COUNT(*) AS n FROM Product WHERE btwFilePath IS NOT NULL AND btwFilePath != ''").get().n;
const inUnused = db.prepare("SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?").get(DB_PREFIX + "не используются\\%").n;
console.log(`Total products with btwFilePath: ${total}`);
console.log(`Under "не используются":         ${inUnused}`);

// Distinct top-level folder names + counts (case-preserving)
const tops = db
  .prepare(
    `SELECT
       CASE
         WHEN instr(substr(btwFilePath, ?), '\\') = 0
           THEN substr(btwFilePath, ?)
         ELSE substr(btwFilePath, ?, instr(substr(btwFilePath, ?), '\\') - 1)
       END AS top,
       COUNT(*) AS n
     FROM Product
     WHERE btwFilePath LIKE ?
     GROUP BY top
     ORDER BY n DESC`
  )
  .all(DB_PREFIX.length + 1, DB_PREFIX.length + 1, DB_PREFIX.length + 1, DB_PREFIX.length + 1, DB_PREFIX + "%");
console.log("\nTop-level folders under extracted_labels (with counts):");
for (const t of tops) console.log(`  ${t.top}  →  ${t.n}`);

// Inside "не используются", show its top-level subfolders
const sub = db
  .prepare(
    `SELECT
       CASE
         WHEN instr(substr(btwFilePath, ?), '\\') = 0
           THEN substr(btwFilePath, ?)
         ELSE substr(btwFilePath, ?, instr(substr(btwFilePath, ?), '\\') - 1)
       END AS top,
       COUNT(*) AS n
     FROM Product
     WHERE btwFilePath LIKE ?
     GROUP BY top
     ORDER BY n DESC`
  )
  .all(
    DB_PREFIX.length + "не используются\\".length + 1,
    DB_PREFIX.length + "не используются\\".length + 1,
    DB_PREFIX.length + "не используются\\".length + 1,
    DB_PREFIX.length + "не используются\\".length + 1,
    DB_PREFIX + "не используются\\%"
  );
console.log("\nInside \"не используются\":");
for (const t of sub) console.log(`  ${t.top}  →  ${t.n}`);
