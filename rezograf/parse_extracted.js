/**
 * IMPROVED parser v2 — better classification of all text objects from BarTender labels.
 * Fixes: better name extraction, showbox detection, no false composition from addresses.
 */
const fs = require('fs');
const path = require('path');

function parseExtractedData(filePath) {
  const raw = fs.readFileSync(filePath, 'utf16le');
  const lines = raw.split('\r\n');
  const products = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('FILE_START=')) {
      current = { filePath: line.substring('FILE_START='.length), objects: [] };
    } else if (line.startsWith('OBJ|') && current) {
      const parts = line.split('|');
      current.objects.push({
        idx: parseInt(parts[1]),
        name: parts[2] || '',
        type: parseInt(parts[3]) || 0,
        value: parts.slice(4).join('|').trim(),
      });
    } else if (line === 'FILE_END') {
      if (current) { products.push(current); current = null; }
    }
  }
  return products;
}

function classifyProduct(fileData) {
  const fileName = path.basename(fileData.filePath, '.btw').trim();

  // Category from folder path
  const pathParts = fileData.filePath.split('\\');
  const labelsIdx = pathParts.findIndex(p => p === 'extracted_labels');
  let category = '', subcategory = '';
  if (labelsIdx >= 0) {
    const after = pathParts.slice(labelsIdx + 1);
    const start = after[0] === 'Цех ПЦО' ? 1 : 0;
    if (start < after.length - 1) category = after[start];
    if (start + 1 < after.length - 1) subcategory = after[start + 1];
  }

  const textObjs = fileData.objects.filter(o => o.type === 5 && o.value.length > 2 && !o.value.startsWith('(error'));
  const barcodeObjs = fileData.objects.filter(o => o.type === 4 && o.value.length > 0);

  let name = '';
  let composition = '';
  let weight = '';
  let storageCond = '';
  let nutritionalInfo = '';
  let manufacturer = '';
  let barcodeEan13 = '';
  let labelType = 'product'; // product | transport | showbox | template

  // ──── 1. BARCODE ────
  for (const obj of barcodeObjs) {
    const v = obj.value.trim();
    if (/^\d{8,14}$/.test(v)) { barcodeEan13 = v; break; }
  }

  // ──── 2. DETECT LABEL TYPE ────
  const allText = textObjs.map(o => o.value).join(' ');
  const isTransport = /количество\s*шт|вес\s*места/i.test(allText);
  const isShowbox = /шоу\s*бокс/i.test(allText);
  const isTemplate = textObjs.some(o => /^(Производитель|Вес нетто:|Вес брутто:)$/i.test(o.value.trim()));

  if (isTemplate) labelType = 'template';
  else if (isShowbox) labelType = 'showbox';
  else if (isTransport) labelType = 'transport';

  // ──── 3. CLASSIFY EACH TEXT OBJECT ────
  const unclassified = [];

  for (const obj of textObjs) {
    const val = obj.value.trim();
    if (!val) continue;

    // Skip pure numbers (article codes, years)
    if (/^\d{1,6}$/.test(val)) {
      if (!barcodeEan13 && val.length >= 8) barcodeEan13 = val;
      continue;
    }

    // Date only
    if (/^\d{2}\.\d{2}\.\d{2,4}$/.test(val)) continue;

    // "Изготовлено и упаковано:" header
    if (/^изготовлено\s*(и|\/)\s*упаковано/i.test(val)) continue;

    // "Упаковано:"
    if (/^упаковано\s*:?\s*$/i.test(val)) continue;

    // "Количество шт:" 
    if (/^количество\s*шт/i.test(val)) continue;

    // "шоу бокс (N шт * X г)"
    if (/^шоу\s*бокс/i.test(val)) continue;

    // Explicit "Состав:" field -> composition
    if (/состав\s*:/i.test(val)) {
      composition = composition ? composition + ' ' + val : val;
      continue;
    }

    // Weight patterns (many variant)
    if (/масса\s*нетто|вес\s*(нетто|брутто|1\s*шт|места)/i.test(val) || /^вес[:\s]/i.test(val)) {
      weight = weight ? weight + '; ' + val : val;
      continue;
    }

    // Storage / shelf life / "Хранить" / "Срок годности"
    if (/срок\s*годности|хранить|годен\s*до|условия\s*хранения/i.test(val)) {
      storageCond = storageCond ? storageCond + '; ' + val : val;
      continue;
    }

    // Nutritional info
    if (/бел[кои]|жир[ыо]|углевод|ккал|энерг|кбжу|пищевая\s*ценность/i.test(val)) {
      nutritionalInfo = nutritionalInfo ? nutritionalInfo + '; ' + val : val;
      continue;
    }

    // Manufacturer (starts with ООО/ИП or contains "изготовитель")
    if (/^ООО\s|^ИП\s|^изготовител/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + '; ' + val : val;
      continue;
    }

    // Address line (6-digit postal code + область)
    if (/\d{6}.*област/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + '; ' + val : val;
      continue;
    }

    // Phone number standalone
    if (/^тел[:\.]?\s*\(?[0-9]/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + '; ' + val : val;
      continue;
    }

    // "Дата фасовки/изготовления/производства"
    if (/дата\s*(фасовки|изготовления|производства)/i.test(val)) continue;

    // "Номер партии"
    if (/номер\s*партии/i.test(val)) continue;

    // "СТО ..." standard number
    if (/^СТО\s/i.test(val) || /^ГОСТ\s/i.test(val) || /^ТУ\s/i.test(val)) continue;

    // Everything else → unclassified
    unclassified.push({ name: obj.name, value: val, len: val.length });
  }

  // ──── 4. EXTRACT COMPOSITION from unclassified ────
  if (!composition) {
    // Long text (>80 chars) that isn't address/storage → likely composition
    const longTexts = unclassified.filter(o =>
      o.len > 80 &&
      !/област|россия.*район|изготовител|хранить|срок/i.test(o.value)
    ).sort((a, b) => b.len - a.len);

    if (longTexts.length > 0) {
      composition = longTexts[0].value;
    }
  }

  // ──── 5. EXTRACT PRODUCT NAME ────
  // Priority: "Текст 3" is usually product name in these BarTender files
  const nameFromText3 = textObjs.find(o =>
    o.name === 'Текст 3' &&
    o.value.length >= 5 && o.value.length <= 200 &&
    !/ООО|ИП|област|хранить|срок|масса|вес|дата|количество|упаковано|шоу\s*бокс|^\d+$/i.test(o.value)
  );

  if (nameFromText3) {
    name = nameFromText3.value.trim();
  } else {
    // Find first short meaningful text object that looks like a product name
    const nameCandidates = unclassified.filter(o =>
      o.len >= 5 && o.len <= 150 &&
      o.value !== composition &&
      !/^\d+$/.test(o.value)
    );
    if (nameCandidates.length > 0) {
      name = nameCandidates[0].value;
    }
  }

  // Fallback to filename
  if (!name) name = fileName;

  // Clean up: if name looks like a date (dd.mm.yyyy), use filename instead
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(name)) {
    name = fileName;
  }

  return {
    name,
    category: category || null,
    subcategory: subcategory || null,
    composition: composition || null,
    weight: weight || null,
    storageCond: storageCond || null,
    nutritionalInfo: nutritionalInfo || null,
    manufacturer: manufacturer || null,
    barcodeEan13: barcodeEan13 || null,
    btwFilePath: fileData.filePath,
    labelType,
  };
}

// ======================== MAIN ========================
const dataFile = path.join(process.cwd(), 'btw_all_data.txt');
console.log('Parsing with improved classifier v2...');
const rawProducts = parseExtractedData(dataFile);
console.log(`Parsed ${rawProducts.length} entries`);

const classified = rawProducts.map(p => classifyProduct(p));

// Stats
const byType = { product: 0, transport: 0, showbox: 0, template: 0 };
classified.forEach(p => { byType[p.labelType] = (byType[p.labelType] || 0) + 1; });

const withComp = classified.filter(p => p.composition).length;
const withBarcode = classified.filter(p => p.barcodeEan13).length;
const withWeight = classified.filter(p => p.weight).length;
const withStorage = classified.filter(p => p.storageCond).length;
const withNutrition = classified.filter(p => p.nutritionalInfo).length;
const withManuf = classified.filter(p => p.manufacturer).length;
const dateNames = classified.filter(p => /^\d{2}\.\d{2}\.\d{4}$/.test(p.name)).length;

console.log('\n📊 RESULTS v2:');
console.log(`  Total: ${classified.length}`);
console.log(`  Label types: product=${byType.product}, transport=${byType.transport}, showbox=${byType.showbox}, template=${byType.template}`);
console.log(`  With composition: ${withComp}`);
console.log(`  With barcode: ${withBarcode}`);
console.log(`  With weight: ${withWeight}`);
console.log(`  With storage: ${withStorage}`);
console.log(`  With nutrition: ${withNutrition}`);
console.log(`  With manufacturer: ${withManuf}`);
console.log(`  Names that are dates: ${dateNames}`);

// Show samples
console.log('\n=== SAMPLES ===');
const samples = classified.filter(p => p.composition && p.composition.includes('Состав')).slice(0, 3);
for (const p of samples) {
  console.log(`\n📦 ${p.name} [${p.labelType}]`);
  console.log(`  Barcode: ${p.barcodeEan13 || '-'}`);
  console.log(`  Weight: ${p.weight || '-'}`);
  console.log(`  Composition: ${(p.composition||'').substring(0, 120)}...`);
  console.log(`  Storage: ${(p.storageCond||'').substring(0, 80)}`);
  console.log(`  Nutrition: ${(p.nutritionalInfo||'').substring(0, 80)}`);
}

// Show transport/showbox examples
console.log('\n=== SHOWBOX EXAMPLES ===');
classified.filter(p => p.labelType === 'showbox').slice(0, 2).forEach(p => {
  console.log(`  📦 ${p.name} [showbox] weight=${p.weight || '-'} barcode=${p.barcodeEan13 || '-'}`);
});

console.log('\n=== TRANSPORT EXAMPLES ===');
classified.filter(p => p.labelType === 'transport').slice(0, 2).forEach(p => {
  console.log(`  📦 ${p.name} [transport] weight=${p.weight || '-'}`);
});

// Write JSON
const outPath = path.join(process.cwd(), 'classified_products.json');
fs.writeFileSync(outPath, JSON.stringify(classified, null, 2), 'utf8');
console.log(`\n✅ JSON written to: ${outPath}`);
