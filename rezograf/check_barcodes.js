const D = require('better-sqlite3');
const db = new D('prisma/dev.db');
const r = db.prepare("SELECT name, barcodeEan13, length(barcodeEan13) as len FROM Product WHERE barcodeEan13 LIKE '2464020120%' LIMIT 10").all();
r.forEach(x => console.log(x.len + ' | ' + x.barcodeEan13 + ' | ' + x.name.substring(0, 50)));
console.log('\n--- Length distribution ---');
const stats = db.prepare("SELECT length(barcodeEan13) as len, COUNT(*) as cnt FROM Product WHERE barcodeEan13 IS NOT NULL GROUP BY length(barcodeEan13)").all();
stats.forEach(x => console.log('  ' + x.len + ' digits: ' + x.cnt + ' products'));
db.close();
