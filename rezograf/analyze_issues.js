/**
 * Analyze data quality issues in classified_products.json
 * 1. Bad product names (from filenames instead of actual product names)
 * 2. Barcode issues (wrong length, invalid check digits)
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'classified_products.json'), 'utf8'));

console.log(`\nTotal products: ${data.length}`);

// 1. Analyze BAD NAMES
const badNamePatterns = [
  { pattern: /^тел[.:]/i, reason: 'Phone number as name' },
  { pattern: /^Россия,/i, reason: 'Address as name' },
  { pattern: /^\d{6},/i, reason: 'Postal code as name' },
  { pattern: /^Фольга ФОТС/i, reason: 'Material code as name' },
  { pattern: /^Ядро КО дробленое/i, reason: 'Generic fallback name' },
];

let badNameCount = 0;
const badNameExamples = [];
for (const item of data) {
  for (const { pattern, reason } of badNamePatterns) {
    if (pattern.test(item.name)) {
      badNameCount++;
      if (badNameExamples.length < 5) {
        badNameExamples.push({ name: item.name, reason, btw: path.basename(item.btwFilePath) });
      }
      break;
    }
  }
}

console.log(`\n--- NAME ISSUES ---`);
console.log(`Products with bad names: ${badNameCount}`);
console.log(`\nExamples:`);
badNameExamples.forEach(e => console.log(`  Name: "${e.name}" | Reason: ${e.reason} | File: ${e.btw}`));

// 2. Analyze BARCODE ISSUES
const withBarcode = data.filter(d => d.barcodeEan13);
const noBarcode = data.filter(d => !d.barcodeEan13);

console.log(`\n--- BARCODE ISSUES ---`);
console.log(`With barcode: ${withBarcode.length}`);
console.log(`Without barcode: ${noBarcode.length}`);

function ean13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(code12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

const lengthStats = {};
let badCheckDigit = 0;
const badCheckExamples = [];

for (const item of withBarcode) {
  const code = item.barcodeEan13;
  const len = code.length;
  lengthStats[len] = (lengthStats[len] || 0) + 1;
  
  if (len === 13) {
    const expected = ean13CheckDigit(code.substring(0, 12));
    const actual = parseInt(code[12]);
    if (expected !== actual) {
      badCheckDigit++;
      if (badCheckExamples.length < 10) {
        badCheckExamples.push({
          code,
          name: item.name.substring(0, 50),
          expected,
          actual,
          corrected: code.substring(0, 12) + expected,
        });
      }
    }
  }
}

console.log(`\nBarcode length distribution:`);
Object.entries(lengthStats).sort((a, b) => a[0] - b[0]).forEach(([len, count]) => {
  console.log(`  ${len} digits: ${count} products`);
});

// Check short barcodes - they're likely missing leading zeros or prefix
const shortCodes = withBarcode.filter(d => d.barcodeEan13.length < 13);
console.log(`\nShort barcodes (< 13 digits): ${shortCodes.length}`);
if (shortCodes.length > 0) {
  console.log(`Examples (showing how to pad):`);
  shortCodes.slice(0, 10).forEach(item => {
    const padded = item.barcodeEan13.padStart(12, '0');
    const check = ean13CheckDigit(padded);
    console.log(`  "${item.barcodeEan13}" -> pad to "${padded}${check}" | Name: ${item.name.substring(0, 40)}`);
  });
}

const longCodes = withBarcode.filter(d => d.barcodeEan13.length > 13);
console.log(`\nLong barcodes (> 13 digits): ${longCodes.length}`);
if (longCodes.length > 0) {
  longCodes.slice(0, 10).forEach(item => {
    console.log(`  "${item.barcodeEan13}" (${item.barcodeEan13.length} digits) | Name: ${item.name.substring(0, 40)}`);
  });
}

console.log(`\n13-digit barcodes with wrong check digit: ${badCheckDigit}`);
if (badCheckExamples.length > 0) {
  console.log(`Examples:`);
  badCheckExamples.forEach(e => {
    console.log(`  Code: ${e.code} | check: got ${e.actual}, expected ${e.expected} -> corrected: ${e.corrected} | ${e.name}`);
  });
}

// Summary of ALL fixable issues
console.log(`\n=== SUMMARY ===`);
console.log(`Total products: ${data.length}`);
console.log(`Bad names to fix: ${badNameCount}`);
console.log(`Barcodes needing normalization (short): ${shortCodes.length}`);
console.log(`Barcodes needing normalization (long): ${longCodes.length}`);
console.log(`Barcodes with wrong check digit: ${badCheckDigit}`);
