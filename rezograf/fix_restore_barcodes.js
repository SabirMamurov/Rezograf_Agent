/**
 * Restore 14-digit barcodes from classified_products.json into the DB.
 * Previously we stripped the leading "2" from 14-digit codes — that was wrong.
 * 14-digit codes starting with "2" are ITF-14 packaging barcodes.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const jsonData = JSON.parse(fs.readFileSync(path.join(__dirname, 'classified_products.json'), 'utf8'));

function calcEan13Check(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(code12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

// Build a lookup: btwFilePath → original barcode from JSON
const barcodeMap = new Map();
for (const item of jsonData) {
  if (item.barcodeEan13 && item.btwFilePath) {
    barcodeMap.set(item.btwFilePath, item.barcodeEan13);
  }
}

const products = db.prepare('SELECT id, barcodeEan13, btwFilePath FROM Product WHERE barcodeEan13 IS NOT NULL').all();
const now = new Date().toISOString();
const update = db.prepare('UPDATE Product SET barcodeEan13 = ?, updatedAt = ? WHERE id = ?');

let restored14 = 0, fixed13 = 0, padded12 = 0;

const apply = db.transaction(() => {
  for (const p of products) {
    const original = barcodeMap.get(p.btwFilePath);
    if (!original) continue;
    
    const clean = original.replace(/[\s-]/g, '');
    let newCode = clean;
    
    if (/^\d{14}$/.test(clean)) {
      // Keep 14-digit codes as-is (ITF-14)
      newCode = clean;
      if (newCode !== p.barcodeEan13) restored14++;
    } else if (/^\d{13}$/.test(clean)) {
      // Fix check digit for 13-digit codes
      const check = calcEan13Check(clean.substring(0, 12));
      newCode = clean.substring(0, 12) + check;
      if (newCode !== p.barcodeEan13) fixed13++;
    } else if (/^\d{12}$/.test(clean)) {
      // Pad 12-digit to 13
      const check = calcEan13Check(clean);
      newCode = clean + check;
      if (newCode !== p.barcodeEan13) padded12++;
    }
    
    if (newCode !== p.barcodeEan13) {
      update.run(newCode, now, p.id);
    }
  }
});

apply();

console.log(`Restored 14-digit ITF-14 barcodes: ${restored14}`);
console.log(`Fixed 13-digit EAN-13 check digits: ${fixed13}`);
console.log(`Padded 12-digit to 13-digit EAN-13: ${padded12}`);

// Verify
const after = db.prepare('SELECT barcodeEan13 FROM Product WHERE barcodeEan13 IS NOT NULL').all();
const stats = { ean13: 0, itf14: 0, other: 0 };
for (const p of after) {
  const len = p.barcodeEan13.length;
  if (len === 13) stats.ean13++;
  else if (len === 14) stats.itf14++;
  else stats.other++;
}
console.log(`\nVerification: EAN-13=${stats.ean13}, ITF-14=${stats.itf14}, Other=${stats.other}`);
db.close();
console.log('✅ Done!');
