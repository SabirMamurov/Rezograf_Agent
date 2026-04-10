const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const rawDataPath = path.join(__dirname, 'btw_all_data.txt');
const raw = fs.readFileSync(rawDataPath, 'utf16le');
const lines = raw.split('\r\n');

const btMap = new Map();
let current = null;

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { filePath: line.substring('FILE_START='.length), objs: [] };
    btMap.set(current.filePath, current);
  } else if (line.startsWith('OBJ|') && current) {
    const parts = line.split('|');
    const val = parts.slice(4).join('|').trim();
    current.objs.push({ name: parts[2] ? parts[2].trim() : '', value: val });
  } else if (line === 'FILE_END') {
    current = null;
  }
}

const products = db.prepare('SELECT id, btwFilePath, weight, quantity, boxWeight, sponsorText FROM Product').all();

const updateStmt = db.prepare(`
  UPDATE Product 
  SET weight = ?, quantity = ?, boxWeight = ?, sponsorText = ?
  WHERE id = ?
`);

let updated = 0;

db.transaction(() => {
  for (const p of products) {
    if (!p.btwFilePath) continue;
    const btInfo = btMap.get(p.btwFilePath);
    if (!btInfo) continue;

    let newWeight = p.weight;
    let newQty = null;
    let newBoxWeight = null;
    let newSponsorText = null;

    for (const obj of btInfo.objs) {
      if (!obj.value) continue;
      const v = obj.value;

      // Extract "Количество шт: 8"
      if (/количество\s*шт/i.test(v)) {
        newQty = v;
      }
      // Extract sponsor text
      if (/создано.*фонда|произведено.*инновациям/i.test(v)) {
        newSponsorText = v;
      }
      
      // Weight extraction - clean up the dirty concatenation that happened before!
      if (/вес\s*места/i.test(v)) {
         newBoxWeight = v;
      } else if (/вес\s*1\s*шт|масса\s*нетто|вес\s*нетто|^вес[:\s]/i.test(v)) {
         // wait, only update newWeight if it's currently a concatenated mess
         // Actually, let's just use the strict individual value from the original file!
         newWeight = v;
      }
    }
    
    // If the old weight in DB is exactly the concatenation (e.g. "Вес 1шт- 100 гр; Вес места - нетто..."),
    // but in original file they were separate, we just overwrite it with individual ones!
    if (newQty || newBoxWeight || newSponsorText) {
       updateStmt.run(newWeight, newQty, newBoxWeight, newSponsorText, p.id);
       updated++;
    }
  }
})();

console.log(`Updated ${updated} products with extra transport/box info.`);
db.close();
