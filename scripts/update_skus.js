/**
 * Update product SKUs in database from extracted BTW data.
 * Now without UNIQUE constraint — same SKU can be used by multiple products.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const skuMapping = JSON.parse(fs.readFileSync(path.join(__dirname, 'sku_mapping.json'), 'utf8'));
console.log(`SKU mappings loaded: ${skuMapping.length}`);

const now = new Date().toISOString();
const update = db.prepare(`UPDATE Product SET sku = ?, updatedAt = ? WHERE btwFilePath = ? AND (sku IS NULL OR sku = '')`);

let updated = 0;
const apply = db.transaction(() => {
  for (const item of skuMapping) {
    const result = update.run(item.sku, now, item.btwFilePath);
    if (result.changes > 0) updated++;
  }
});
apply();

// Verify
const total = db.prepare('SELECT COUNT(*) as c FROM Product').get().c;
const withSku = db.prepare(`SELECT COUNT(*) as c FROM Product WHERE sku IS NOT NULL AND sku != ''`).get().c;

console.log(`Updated: ${updated} products with SKU`);
console.log(`Total products: ${total}`);
console.log(`Products with SKU: ${withSku}`);
console.log(`Products without SKU: ${total - withSku}`);

// Show some examples
const examples = db.prepare('SELECT name, sku, barcodeEan13 FROM Product WHERE sku IS NOT NULL LIMIT 10').all();
console.log('\nExamples:');
examples.forEach(e => console.log(`  SKU: ${e.sku} | Barcode: ${e.barcodeEan13 || '-'} | ${e.name.substring(0, 50)}`));

db.close();
console.log('\n✅ SKU update complete!');
