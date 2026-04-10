const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const rawDataPath = path.join(__dirname, 'btw_all_data.txt');
const raw = fs.readFileSync(rawDataPath, 'utf16le');
const lines = raw.split('\r\n');

// 1. Build map of filePath -> textObjs
const btMap = new Map();
let current = null;

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { filePath: line.substring('FILE_START='.length), textObjs: [] };
    btMap.set(current.filePath, current);
  } else if (line.startsWith('OBJ|') && current) {
    const parts = line.split('|');
    const val = parts.slice(4).join('|').trim();
    current.textObjs.push({ name: parts[2] ? parts[2].trim() : '', value: val });
  } else if (line === 'FILE_END') {
    current = null;
  }
}

// 2. Define bad names regex to exclude bad text
const isBadText = (str) => {
  if (str.length < 5 || str.length > 200) return true;
  return /ООО|ИП|област|хранить|срок\s*годн|масса|вес|дата|количество|упаковано|шоу\s*бокс|создано|произведено|разработано|фонда|тел\.|состав/i.test(str);
};

const cleanFileName = (filePath) => {
    let cleanName = path.basename(filePath, '.btw')
      .replace(/старые 15 вложений/gi, '')
      .replace(/\s*\d+\s*(кг|г|гр|шт|мл)\s*/gi, ' ')
      .replace(/\s*(90х70|90x70)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanName;
};

const products = db.prepare('SELECT id, name, btwFilePath FROM Product').all();
const updateName = db.prepare('UPDATE Product SET name = ? WHERE id = ?');

let updated = 0;
const changes = [];

db.transaction(() => {
  for (const p of products) {
    if (!p.btwFilePath) continue;
    
    let betterName = null;
    const btInfo = btMap.get(p.btwFilePath);
    
    let text3Value = null;
    if (btInfo) {
      const t3 = btInfo.textObjs.find(o => o.name === 'Текст 3');
      if (t3 && !isBadText(t3.value)) {
        text3Value = t3.value;
      }
    }

    const cleanedFile = cleanFileName(p.btwFilePath);
    
    // Some logic to pick the best name:
    // If current name is BAD...
    const currentIsBad = isBadText(p.name);
    // Or if current name doesn't match T3 (and T3 is available), we prefer T3!
    
    if (text3Value && p.name !== text3Value) {
      betterName = text3Value;
    } else if (currentIsBad && !text3Value) {
      betterName = cleanedFile;
    }
    
    // Only update if it really changed
    if (betterName && betterName !== p.name && !isBadText(betterName)) {
      updateName.run(betterName, p.id);
      changes.push(`[${p.btwFilePath}]\n   OLD: ${p.name}\n   NEW: ${betterName}\n`);
      updated++;
    }
  }
})();

console.log(`Updated ${updated} product names.`);
if (updated > 0) {
  console.log("Samples:");
  console.log(changes.slice(0, 20).join('\n'));
}

db.close();
