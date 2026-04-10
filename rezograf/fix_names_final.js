const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

// ═══════ 1. Load all available raw data ═══════
function loadRawData(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const raw = fs.readFileSync(filePath, 'utf16le');
  const lines = raw.split('\r\n');
  const map = new Map();
  let current = null;

  for (const line of lines) {
    if (line.startsWith('FILE_START=')) {
      current = { filePath: line.substring('FILE_START='.length), objs: [] };
    } else if (line.startsWith('OBJ|') && current) {
      const parts = line.split('|');
      const val = parts.slice(4).join('|').trim();
      current.objs.push({ name: parts[2] ? parts[2].trim() : '', value: val });
    } else if (line === 'FILE_END') {
      if (current) { 
        let np = current.filePath;
        np = np.split('\\Цех ПЦШ\\ЦЕХ ПЦШ\\').join('\\Цех ПЦШ\\');
        np = np.split('\\Цех ПЦБ\\Цех ПЦБ\\').join('\\Цех ПЦБ\\');
        map.set(np, current); 
        current = null; 
      }
    }
  }
  return map;
}

// Load all available raw data files
const btData = loadRawData(path.join(__dirname, 'btw_all_data.txt'));
const importData = loadRawData(path.join(__dirname, 'import_data.txt'));
const importPcsh = loadRawData(path.join(__dirname, 'import_data_pcsh.txt'));
console.log(`Loaded raw data: btw_all_data=${btData.size}, import_data=${importData.size}, pcsh_backup=${importPcsh.size}`);

// Merge all maps (later sources override earlier ones)
const allRaw = new Map([...btData, ...importPcsh, ...importData]);

// ═══════ 2. Define bad-name detector ═══════
const isBadName = (str) => {
  if (!str || str.length < 3) return true;
  return /^тел[.:]/i.test(str) ||
    /ООО "|^ИП\s/i.test(str) ||
    /^Россия,/i.test(str) ||
    /^\d{6}[,\s]/i.test(str) ||
    /област|район/i.test(str) ||
    /создано|произведено|разработано|фонда/i.test(str) ||
    /хранить|срок\s*годн/i.test(str) ||
    /количество\s*шт/i.test(str) ||
    /^\s*вес\s*(1|места)/i.test(str) ||
    /^масса\s*нетто/i.test(str) ||
    /^изготовлено/i.test(str) ||
    /^\s*\d{2}\.\d{2}\.\d{2,4}\.?\s*$/.test(str) ||
    /^\d{3,6}\.?\s*$/.test(str) ||
    /^Фольга/i.test(str);
};

const isBadText = (str) => {
  if (!str || str.length < 5 || str.length > 200) return true;
  return /ООО "|^ИП\s|област|хранить|срок\s*годн|^масса|^\s*вес|дата|количество\s*шт|упаковано|шоу\s*бокс|создано|произведено|разработано|фонда|^тел\.\s|^состав|изготовлено/i.test(str);
};

// ═══════ 3. Fix names and extract missing data ═══════
const products = db.prepare('SELECT * FROM Product').all();
const updateStmt = db.prepare(`
  UPDATE Product SET name = ?, weight = ?, quantity = ?, boxWeight = ?, 
    sponsorText = ?, certCode = ?, storageCond = COALESCE(?, storageCond)
  WHERE id = ?
`);

let fixedNames = 0;
let fixedExtra = 0;
const changes = [];

db.transaction(() => {
  for (const p of products) {
    if (!p.btwFilePath) continue;
    
    const raw = allRaw.get(p.btwFilePath);
    let newName = p.name;
    let newWeight = p.weight;
    let newQty = p.quantity;
    let newBoxWeight = p.boxWeight;
    let newSponsor = p.sponsorText;
    let newCert = p.certCode;
    let newStorage = null;
    
    if (raw) {
      // Try to find proper name from Текст 3 — ALWAYS prefer it over filename-derived names
      const t3 = raw.objs.find(o => o.name === 'Текст 3');
      if (t3 && !isBadText(t3.value) && p.name !== t3.value.trim()) {
        newName = t3.value.trim();
      }
      
      // Extract missing extra data
      for (const obj of raw.objs) {
        if (!obj.value || obj.value.startsWith('(error')) continue;
        const v = obj.value;
        
        if (!newQty && /количество\s*шт/i.test(v)) newQty = v;
        if (!newBoxWeight && /вес\s*места/i.test(v)) newBoxWeight = v;
        if (!newSponsor && /создано.*произведено|фонда\s*содействия/i.test(v)) newSponsor = v;
        if (!newCert && /^(СТО|ГОСТ|ТУ)\s+[-\d\.]+/i.test(v)) newCert = v;
        if (!newStorage && /хранить|срок\s*годн|температур.*хранен/i.test(v) && v.length > 15) newStorage = v;
        
        // Fix weight - use individual piece weight specifically
        if (/вес\s*1\s*шт|масса\s*нетто\s*[:\d]/i.test(v) && v.length < 80) {
          if (!newWeight || newWeight.includes(';')) newWeight = v;
        }
      }
    }
    
    // Fallback: if name is still bad, use filename
    if (isBadName(newName)) {
      const fileName = path.basename(p.btwFilePath, '.btw').trim()
        .replace(/\s*\d+\s*(кг|г|гр|шт|мл)\s*/gi, ' ')
        .replace(/\s*(90х70|90x70)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (fileName.length > 3) newName = fileName;
    }
    
    const nameChanged = newName !== p.name;
    const extraChanged = newWeight !== p.weight || newQty !== p.quantity || 
      newBoxWeight !== p.boxWeight || newSponsor !== p.sponsorText || newCert !== p.certCode;
    
    if (nameChanged || extraChanged || newStorage) {
      updateStmt.run(newName, newWeight, newQty, newBoxWeight, newSponsor, newCert, newStorage, p.id);
      if (nameChanged) {
        fixedNames++;
        changes.push(`  "${p.name}" → "${newName}"`);
      }
      if (extraChanged) fixedExtra++;
    }
  }
})();

console.log(`\n✅ Исправлено названий: ${fixedNames}`);
console.log(`✅ Дополнено данных: ${fixedExtra}`);
if (changes.length > 0) {
  console.log('\nПримеры изменений:');
  console.log(changes.slice(0, 15).join('\n'));
  if (changes.length > 15) console.log(`  ... и ещё ${changes.length - 15}`);
}

db.close();
