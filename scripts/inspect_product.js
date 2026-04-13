const Database = require('better-sqlite3');
const db = new Database('./prisma/dev.db');

const row = db.prepare(`SELECT * FROM Product WHERE sku = '9220' LIMIT 1`).get();
console.log('=== Product SKU 9220 ===');
for (const [key, val] of Object.entries(row)) {
  if (val && key !== 'id' && key !== 'templateId' && key !== 'createdAt' && key !== 'updatedAt') {
    console.log(`\n--- ${key} ---`);
    console.log(val);
  }
}
