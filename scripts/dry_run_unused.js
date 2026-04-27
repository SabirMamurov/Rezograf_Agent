// Dry-run: find products whose source .btw on P:\ has mtime < 2025-01-01
// and report what would be moved into a "не используются" virtual folder.
// READ-ONLY — does not modify the DB.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "prisma", "dev.db");
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
const P_BASE = "P:\\Rizograf\\От Салаховой";
const WORKSHOPS = ["Цех ПЦО", "ЦЕХ ПЦШ", "Цех ПЦБ"];
const CUTOFF = new Date("2025-01-01T00:00:00").getTime();

const db = new Database(DB_PATH, { readonly: true });

// 1. Snapshot of all products with btwFilePath under one of the 3 workshops
const rows = db.prepare(
  `SELECT id, name, sku, btwFilePath FROM Product WHERE btwFilePath IS NOT NULL AND btwFilePath != ''`
).all();

const inWorkshop = (p) => {
  if (!p.startsWith(DB_PREFIX)) return null;
  const rel = p.slice(DB_PREFIX.length);
  for (const w of WORKSHOPS) {
    if (rel.startsWith(w + "\\") || rel === w) return w;
    // case-insensitive workshop match
    const head = rel.split("\\")[0];
    if (head && head.toLowerCase() === w.toLowerCase()) return head;
  }
  return null;
};

const productsByWorkshop = {};
for (const w of WORKSHOPS) productsByWorkshop[w] = [];
let prefixedTotal = 0;
let outsideWorkshops = 0;
for (const r of rows) {
  const w = inWorkshop(r.btwFilePath);
  if (w) {
    prefixedTotal++;
    const wKey = WORKSHOPS.find((x) => x.toLowerCase() === w.toLowerCase()) || w;
    productsByWorkshop[wKey].push(r);
  } else if (r.btwFilePath.startsWith(DB_PREFIX)) {
    outsideWorkshops++;
  }
}

console.log(`Products with btwFilePath: ${rows.length}`);
console.log(`  → in 3 workshops: ${prefixedTotal}`);
console.log(`  → other extracted_labels subfolders: ${outsideWorkshops}`);
for (const w of WORKSHOPS) {
  console.log(`    ${w}: ${productsByWorkshop[w].length}`);
}

// 2. For each product, derive the candidate P:\ path and stat it
function dbPathToPPath(dbp) {
  if (!dbp.startsWith(DB_PREFIX)) return null;
  return path.join(P_BASE, dbp.slice(DB_PREFIX.length));
}

let stale = 0;
let fresh = 0;
let missing = 0;
const samples = { stale: [], missing: [], fresh: [] };
const staleIds = [];

for (const w of WORKSHOPS) {
  for (const r of productsByWorkshop[w]) {
    if (r.name === "_folder_marker") continue; // sentinel
    const ppath = dbPathToPPath(r.btwFilePath);
    let st;
    try {
      st = fs.statSync(ppath);
    } catch {
      missing++;
      if (samples.missing.length < 5) samples.missing.push({ id: r.id, name: r.name, p: ppath });
      continue;
    }
    if (st.mtimeMs < CUTOFF) {
      stale++;
      staleIds.push(r.id);
      if (samples.stale.length < 10)
        samples.stale.push({
          id: r.id,
          name: r.name,
          sku: r.sku,
          mtime: new Date(st.mtimeMs).toISOString().slice(0, 10),
          db: r.btwFilePath,
        });
    } else {
      fresh++;
      if (samples.fresh.length < 3)
        samples.fresh.push({
          id: r.id,
          name: r.name,
          mtime: new Date(st.mtimeMs).toISOString().slice(0, 10),
        });
    }
  }
}

console.log("");
console.log("Per-product file mtime check (excluding _folder_marker):");
console.log(`  stale  (mtime < 2025-01-01): ${stale}  ← would be moved`);
console.log(`  fresh  (mtime ≥ 2025-01-01): ${fresh}`);
console.log(`  missing on P:\\         : ${missing}`);

console.log("");
console.log("Sample stale (first 10):");
for (const s of samples.stale) console.log("  -", s);
console.log("");
console.log("Sample missing (first 5):");
for (const s of samples.missing) console.log("  -", s);
console.log("");
console.log("Sample fresh (first 3):");
for (const s of samples.fresh) console.log("  -", s);

// 3. Show what the rewrite would look like
console.log("");
console.log("Rewrite preview (first 5 stale):");
for (const s of samples.stale.slice(0, 5)) {
  const rel = s.db.slice(DB_PREFIX.length);
  const newPath = DB_PREFIX + "не используются\\" + rel;
  console.log("  FROM:", s.db);
  console.log("  TO  :", newPath);
  console.log("");
}

// 4. Save the stale id list for the (later) update script
const out = path.join(__dirname, "stale_ids.json");
fs.writeFileSync(out, JSON.stringify({ cutoff: "2025-01-01", count: stale, ids: staleIds }, null, 2));
console.log(`Wrote ${stale} stale ids to ${out}`);
