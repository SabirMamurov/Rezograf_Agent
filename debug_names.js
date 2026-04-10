const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rawDataPath = path.join(__dirname, 'btw_all_data.txt');
const raw = fs.readFileSync(rawDataPath, 'utf16le');
const lines = raw.split('\r\n');

// Build products from raw
const btProducts = [];
let current = null;

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { filePath: line.substring('FILE_START='.length), textObjs: [] };
    btProducts.push(current);
  } else if (line.startsWith('OBJ|') && current) {
    const parts = line.split('|');
    const val = parts.slice(4).join('|').trim();
    current.textObjs.push({ name: parts[2] || '', value: val });
  }
}

console.log('Total files parsed from txt:', btProducts.length);

const badNames = [
  "создано", "произведено", "разработано", "при поддержке", "фонда"
];

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const productsInDb = db.prepare('SELECT id, name, btwFilePath FROM Product').all();

let suspects = 0;
for (const p of productsInDb) {
  const isBad = badNames.some(b => p.name.toLowerCase().includes(b));
  if (isBad) {
    suspects++;
    console.log(`\nSUSPECT NAME: ${p.name}`);
    console.log(`FILE: ${p.btwFilePath}`);
    
    // Find all text objects for this file
    const bt = btProducts.find(b => b.filePath === p.btwFilePath);
    if (!bt) continue;

    console.log('--- ALL TEXT OBJS IN FILE ---');
    bt.textObjs.forEach(o => {
      console.log(`[${o.name}] => ${o.value}`);
    });
  }
}
console.log(`\nFound ${suspects} suspect names in DB.`);
db.close();
