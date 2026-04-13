const Database = require('better-sqlite3');
const db = new Database('./prisma/dev.db');

// Fix product SKU 9220 - Кедровый орех расщепленный обжаренный
db.prepare(`
  UPDATE Product SET
    composition = 'Состав: орехи кедровые расщепленные (жареные в масле), соль пищевая',
    weight = 'Масса нетто: 100 г',
    certCode = 'СТО 97588510-048-2021',
    storageCond = 'Срок годности: 6 месяцев. Хранить при температуре от +7 до +20 °С и относительной влажности не более 70 %'
  WHERE sku = '9220'
`).run();

console.log('Product 9220 fixed!');

// Verify
const row = db.prepare(`SELECT composition, weight, certCode, storageCond FROM Product WHERE sku = '9220' LIMIT 1`).get();
console.log('\nVerification:');
for (const [key, val] of Object.entries(row)) {
  console.log(`  ${key}: ${val}`);
}
