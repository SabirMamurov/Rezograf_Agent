/**
 * fix_all_data.js — Fix product names and barcodes in the SQLite database.
 * 
 * Fixes:
 * 1. BAD NAMES: Products where the name was incorrectly extracted 
 *    (phone numbers, addresses, material codes, generic fallbacks).
 *    Tries to find the real product name from composition or btw file path.
 * 
 * 2. BARCODES: Normalize all barcodes to valid EAN-13:
 *    - 14 digits starting with '2': strip leading '2'
 *    - 12 digits: pad and add check digit
 *    - 13 digits: fix check digit
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

// ──── EAN-13 Check Digit Calculator ────
function calcEan13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(code12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function normalizeBarcode(raw) {
  if (!raw) return null;
  let clean = raw.replace(/[\s-]/g, '');
  
  // 14 digits starting with '2' — strip BarTender packaging prefix
  if (/^2\d{13}$/.test(clean)) {
    clean = clean.substring(1);
  }
  
  // 12 digits — add check digit
  if (/^\d{12}$/.test(clean)) {
    const check = calcEan13CheckDigit(clean);
    return clean + check;
  }
  
  // 13 digits — fix check digit
  if (/^\d{13}$/.test(clean)) {
    const base12 = clean.substring(0, 12);
    const check = calcEan13CheckDigit(base12);
    return base12 + check;
  }
  
  // 8 digits - EAN-8, return as-is
  if (/^\d{8}$/.test(clean)) {
    return clean;
  }
  
  return clean;
}

// ──── Extract better product name ────
function extractBetterName(product) {
  const { name, composition, btwFilePath, weight } = product;
  
  // Check if current name is problematic
  const isBadName = 
    /^тел[.:]/i.test(name) ||
    /^Россия,/i.test(name) ||
    /^\d{6},/i.test(name) ||
    /^Фольга ФОТС/i.test(name) ||
    /^Ядро КО дробленое\s+\(сечка\)$/i.test(name);
  
  if (!isBadName) return null; // Name is fine
  
  // Strategy 1: Extract from composition if it has a clear product name prefix
  if (composition) {
    // Some compositions start with product name before "Состав:"
    // e.g., "Конфеты ... Состав: ..."
    const compMatch = composition.match(/^([^.]+?)(?:\s*Состав\s*:|$)/);
    if (compMatch && compMatch[1].length > 5 && compMatch[1].length < 150) {
      const candidate = compMatch[1].trim();
      if (!/^Состав/i.test(candidate) && !/тел\./i.test(candidate)) {
        return candidate;
      }
    }
  }
  
  // Strategy 2: Extract from btw file path
  if (btwFilePath) {
    const fileName = path.basename(btwFilePath, '.btw').trim();
    // Clean up typical filename patterns
    let cleanName = fileName
      .replace(/\s*\d+\s*(кг|г|гр|шт|мл)\s*/gi, ' ') // Remove weight from filename
      .replace(/\s*(90х70|90x70)\s*/gi, '') // Remove label sizes
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleanName.length > 3) {
      return cleanName;
    }
  }
  
  return null; // Can't determine a better name
}

// ============ MAIN ============
console.log('🔧 Starting database fix...\n');

// Get all products
const products = db.prepare('SELECT * FROM Product').all();
console.log(`Total products in DB: ${products.length}\n`);

// Prepare update statements
const now = new Date().toISOString();
const updateName = db.prepare(`UPDATE Product SET name = ?, updatedAt = ? WHERE id = ?`);
const updateBarcode = db.prepare(`UPDATE Product SET barcodeEan13 = ?, updatedAt = ? WHERE id = ?`);

// ── FIX NAMES ──
console.log('--- FIXING NAMES ---');
let namesFixed = 0;
const nameChanges = [];

for (const p of products) {
  const betterName = extractBetterName(p);
  if (betterName) {
    nameChanges.push({ id: p.id, old: p.name, new: betterName });
    namesFixed++;
  }
}

// Apply name changes in transaction
const applyNames = db.transaction(() => {
  for (const change of nameChanges) {
    updateName.run(change.new, now, change.id);
  }
});
applyNames();

console.log(`Fixed ${namesFixed} product names`);
nameChanges.slice(0, 10).forEach(c => {
  console.log(`  "${c.old}" → "${c.new}"`);
});
if (nameChanges.length > 10) console.log(`  ... and ${nameChanges.length - 10} more`);

// ── FIX BARCODES ──
console.log('\n--- FIXING BARCODES ---');
let barcodesFixed = 0;
const barcodeChanges = [];

for (const p of products) {
  if (!p.barcodeEan13) continue;
  
  const normalized = normalizeBarcode(p.barcodeEan13);
  if (normalized !== p.barcodeEan13) {
    barcodeChanges.push({ id: p.id, old: p.barcodeEan13, new: normalized, name: p.name.substring(0, 40) });
    barcodesFixed++;
  }
}

// Apply barcode changes in transaction
const applyBarcodes = db.transaction(() => {
  for (const change of barcodeChanges) {
    updateBarcode.run(change.new, now, change.id);
  }
});
applyBarcodes();

console.log(`Fixed ${barcodesFixed} barcodes`);
barcodeChanges.slice(0, 15).forEach(c => {
  console.log(`  ${c.old} → ${c.new} | ${c.name}`);
});
if (barcodeChanges.length > 15) console.log(`  ... and ${barcodeChanges.length - 15} more`);

// ── VERIFY ──
console.log('\n--- VERIFICATION ---');
const afterProducts = db.prepare('SELECT * FROM Product').all();
const stillBadNames = afterProducts.filter(p => 
  /^тел[.:]/i.test(p.name) || /^Россия,/i.test(p.name) || /^\d{6},/i.test(p.name)
).length;

const withBarcode = afterProducts.filter(p => p.barcodeEan13);
let validEan13 = 0;
for (const p of withBarcode) {
  const code = p.barcodeEan13;
  if (/^\d{13}$/.test(code)) {
    const check = calcEan13CheckDigit(code.substring(0, 12));
    if (check === parseInt(code[12])) validEan13++;
  }
}

console.log(`Still bad names: ${stillBadNames}`);
console.log(`Total with barcode: ${withBarcode.length}`);
console.log(`Valid EAN-13 barcodes: ${validEan13}`);
console.log(`EAN-13 validation rate: ${(validEan13 / withBarcode.length * 100).toFixed(1)}%`);

db.close();
console.log('\n✅ Database fix complete!');
