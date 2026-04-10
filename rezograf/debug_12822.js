const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'prisma', 'dev.db'));

// Find the problem product
const p = db.prepare("SELECT * FROM Product WHERE sku = '12822'").get();
if (!p) { console.log('Product 12822 not found'); process.exit(1); }
console.log('DB record:', JSON.stringify(p, null, 2));

// Find in raw data
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

const allRaw = new Map([
  ...loadRawData(path.join(__dirname, 'btw_all_data.txt')),
  ...loadRawData(path.join(__dirname, 'import_data_pcsh.txt')),
  ...loadRawData(path.join(__dirname, 'import_data.txt')),
]);

const raw = allRaw.get(p.btwFilePath);
if (raw) {
  console.log('\nRAW TEXT OBJECTS:');
  raw.objs.forEach(o => console.log(`  [${o.name}] => ${o.value}`));
  
  const isBadName = (str) => {
    if (!str || str.length < 3) return true;
    return /^тел[.:]/i.test(str) || /ООО|ИП/i.test(str) || /^Россия,/i.test(str) || /^\d{6}[,\s]/i.test(str) || /област|район/i.test(str) || /создано|произведено|разработано|фонда/i.test(str) || /хранить|срок\s*годн/i.test(str) || /количество\s*шт/i.test(str) || /вес\s*(1|места)/i.test(str) || /масса\s*нетто/i.test(str) || /^изготовлено/i.test(str) || /^\d{2}\.\d{2}\.\d{4}$/.test(str) || /^\d{3,6}$/.test(str) || /^Фольга/i.test(str);
  };

  const isBadText = (str) => {
    if (!str || str.length < 5 || str.length > 200) return true;
    return /ООО|ИП|област|хранить|срок\s*годн|масса|вес|дата|количество|упаковано|шоу\s*бокс|создано|произведено|разработано|фонда|тел\.|состав|изготовлено/i.test(str);
  };
  
  let newName = p.name;
  const t3 = raw.objs.find(o => o.name === 'Текст 3');
  
  console.log('\nEVALUATING:');
  console.log('t3 matches:', !!t3);
  if (t3) {
    console.log('isBadText(t3.value):', isBadText(t3.value));
    console.log('p.name !== t3.value.trim():', p.name !== t3.value.trim());
    if (!isBadText(t3.value) && p.name !== t3.value.trim()) {
      newName = t3.value.trim();
    }
  }
  
  if (isBadName(newName)) {
    console.log('newName was considered badName!');
  }
  
  console.log('FINAL newName:', newName);
  console.log('nameChanged:', newName !== p.name);
}

db.close();
