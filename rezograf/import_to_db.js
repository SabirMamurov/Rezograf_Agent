/**
 * import_to_db.js — Автоматический парсер и импорт этикеток в базу данных.
 * 
 * Использование:
 *   node import_to_db.js                        — парсит import_data.txt
 *   node import_to_db.js "C:\path\to\data.txt"  — парсит указанный файл
 * 
 * Полный импорт из папки с .btw файлами (2 шага):
 *   Шаг 1: cscript import_folder.vbs "C:\path\to\labels"
 *   Шаг 2: node import_to_db.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const dataFile = process.argv[2] || path.join(__dirname, 'import_data.txt');

if (!fs.existsSync(dataFile)) {
  console.error(`❌ Файл не найден: ${dataFile}`);
  console.log('Сначала выполните извлечение:');
  console.log('  cscript import_folder.vbs "C:\\путь\\к\\папке"');
  process.exit(1);
}

console.log(`📂 Чтение: ${dataFile}`);

// ════════════════ 1. PARSE RAW TEXT FILE ════════════════
const raw = fs.readFileSync(dataFile, 'utf16le');
const lines = raw.split('\r\n');

const entries = [];
let current = null;

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { filePath: line.substring('FILE_START='.length), objs: [] };
  } else if (line.startsWith('OBJ|') && current) {
    const parts = line.split('|');
    const val = parts.slice(4).join('|').trim();
    current.objs.push({
      idx: parseInt(parts[1]),
      name: parts[2] ? parts[2].trim() : '',
      type: parseInt(parts[3]) || 0,
      value: val,
    });
  } else if (line === 'FILE_END') {
    if (current) { entries.push(current); current = null; }
  }
}

console.log(`📊 Разобрано файлов: ${entries.length}`);

// ════════════════ 2. CLASSIFY EACH ENTRY ════════════════
function classifyEntry(entry) {
  const fileName = path.basename(entry.filePath, '.btw').trim();
  
  // Category/subcategory from folder path  
  const pathParts = entry.filePath.split('\\');
  // Find any known root folder marker
  let rootIdx = -1;
  for (let i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'extracted_labels' || pathParts[i] === 'Цех ПЦО') {
      rootIdx = i;
    }
  }
  
  let category = '', subcategory = '';
  if (rootIdx >= 0) {
    const after = pathParts.slice(rootIdx + 1);
    // Skip "Цех ПЦО" if it's first
    const start = after[0] === 'Цех ПЦО' ? 1 : 0;
    if (start < after.length - 1) category = after[start];
    if (start + 1 < after.length - 1) subcategory = after[start + 1];
  }

  const textObjs = entry.objs.filter(o => o.type === 5 && o.value.length > 2 && !o.value.startsWith('(error'));
  const barcodeObjs = entry.objs.filter(o => o.type === 4 && o.value.length > 0);

  let name = '';
  let composition = '';
  let weight = '';
  let storageCond = '';
  let nutritionalInfo = '';
  let manufacturer = '';
  let barcodeEan13 = '';
  let sku = '';
  let certCode = '';
  let quantity = '';
  let boxWeight = '';
  let sponsorText = '';

  // ── BARCODE ──
  for (const obj of barcodeObjs) {
    const v = obj.value.trim();
    if (/^\d{8,14}$/.test(v)) barcodeEan13 = v;
  }

  // ── CLASSIFY TEXT OBJECTS ──
  const unclassified = [];
  for (const obj of textObjs) {
    const val = obj.value;
    
    // Manufacturer (ООО/ИП + address)
    if (/ООО|ИП/i.test(val) && /тел|фабрик|завод|компани/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + '; ' + val : val;
      continue;
    }
    // Address only
    if (/^\d{6}[,\s]+Росси/i.test(val) || /область.*район/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + '; ' + val : val;
      continue;
    }

    // Storage conditions
    if (/хранить|срок\s*годн|температур.*хранен/i.test(val) && val.length > 15) {
      storageCond = val;
      continue;
    }

    // Weight (individual piece)
    if (/вес\s*1\s*шт|масса\s*нетто\s*[:\d]|^масса\s/i.test(val) && val.length < 80) {
      weight = val;
      continue;
    }

    // Box weight  
    if (/вес\s*места/i.test(val)) {
      boxWeight = val;
      continue;
    }

    // Quantity
    if (/количество\s*шт/i.test(val)) {
      quantity = val;
      continue;
    }

    // Nutritional info
    if (/калорийн|энерг.*ценн|белк.*жир|пищев.*ценн|ккал/i.test(val) && val.length > 20) {
      nutritionalInfo = val;
      continue;
    }

    // Composition
    if (/^состав\s*[:;]/i.test(val) || (val.length > 100 && /сахар|мука|масло|мед|орех|какао/i.test(val))) {
      composition = val;
      continue;
    }

    // SKU (short numeric code, usually "Текст 10" or similar)
    if (/^\d{3,6}$/.test(val) && !sku) {
      sku = val;
      continue;
    }

    // Cert code (СТО/ГОСТ/ТУ)
    if (/^(СТО|ГОСТ|ТУ)\s+[-\d\.]+/i.test(val)) {
      certCode = val;
      continue;
    }

    // Sponsor text
    if (/создано.*произведено|фонда\s*содействия/i.test(val)) {
      sponsorText = val;
      continue;
    }

    // Date fields — skip
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) continue;
    if (/дата\s*(фасовки|изготовления|производства)/i.test(val)) continue;
    if (/номер\s*партии/i.test(val)) continue;
    if (/^изготовлено\s*(и|$)/i.test(val)) continue;

    unclassified.push({ name: obj.name, value: val, len: val.length });
  }

  // ── NAME EXTRACTION ──
  // Priority: "Текст 3" is usually the product name
  const isBadText = (str) => {
    if (!str || str.length < 5 || str.length > 200) return true;
    if (/^\s*\d{2}\.\d{2}\.\d{2,4}\.?\s*$/.test(str)) return true;
    return /ООО "|^ИП\s|област|хранить|срок\s*годн|^масса|^\s*вес|дата|количество\s*шт|упаковано|шоу\s*бокс|создано|произведено|разработано|фонда|^тел\.\s|^состав|изготовлено/i.test(str);
  };

  const t3 = textObjs.find(o => o.name === 'Текст 3');
  if (t3 && !isBadText(t3.value)) {
    name = t3.value.trim();
  } else {
    // Try to find from unclassified short texts
    const candidates = unclassified.filter(o =>
      o.len >= 5 && o.len <= 150 &&
      o.value !== composition && !isBadText(o.value)
    );
    if (candidates.length > 0) {
      name = candidates[0].value;
    }
  }

  // Fallback to filename
  if (!name || isBadText(name)) name = fileName;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(name)) name = fileName;

  // ── COMPOSITION from unclassified ──
  if (!composition) {
    const longTexts = unclassified.filter(o =>
      o.len > 80 && !/област|россия.*район|изготовител|хранить|срок/i.test(o.value)
    ).sort((a, b) => b.len - a.len);
    if (longTexts.length > 0) composition = longTexts[0].value;
  }

  return {
    name, sku: sku || null, category: category || null, subcategory: subcategory || null,
    composition: composition || null, weight: weight || null,
    storageCond: storageCond || null, nutritionalInfo: nutritionalInfo || null,
    manufacturer: manufacturer || null, barcodeEan13: barcodeEan13 || null,
    btwFilePath: entry.filePath, certCode: certCode || null,
    quantity: quantity || null, boxWeight: boxWeight || null, sponsorText: sponsorText || null,
  };
}

const classified = entries.map(e => classifyEntry(e));

// ════════════════ 3. INSERT INTO DATABASE ════════════════
const db = new Database(dbPath);

// Get default template
const defaultTemplate = db.prepare('SELECT id FROM Template LIMIT 1').get();
const templateId = defaultTemplate ? defaultTemplate.id : null;

// Check existing products to avoid duplicates
const existingPaths = new Set(
  db.prepare('SELECT btwFilePath FROM Product WHERE btwFilePath IS NOT NULL').all()
    .map(r => r.btwFilePath)
);

const insertStmt = db.prepare(`
  INSERT INTO Product (id, name, sku, category, subcategory, composition, weight, nutritionalInfo,
    storageCond, manufacturer, barcodeEan13, btwFilePath, certCode, quantity, boxWeight, sponsorText,
    templateId, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

let imported = 0;
let skipped = 0;
const now = new Date().toISOString();

db.transaction(() => {
  for (const p of classified) {
    if (existingPaths.has(p.btwFilePath)) {
      skipped++;
      continue;
    }

    insertStmt.run(
      uuid(), p.name, p.sku, p.category, p.subcategory, p.composition, p.weight,
      p.nutritionalInfo, p.storageCond, p.manufacturer, p.barcodeEan13, p.btwFilePath,
      p.certCode, p.quantity, p.boxWeight, p.sponsorText,
      templateId, now, now
    );
    imported++;
  }
})();

console.log(`\n✅ Импорт завершён!`);
console.log(`   Новых товаров: ${imported}`);
console.log(`   Пропущено (дубли): ${skipped}`);
console.log(`   Всего в файле: ${classified.length}`);

const total = db.prepare('SELECT COUNT(*) as c FROM Product').get();
console.log(`   Всего в базе: ${total.c}`);

db.close();
