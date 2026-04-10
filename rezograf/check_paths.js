const db = require('better-sqlite3')('prisma/dev.db');
const r1 = db.prepare("SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%Цех ПЦШ%' LIMIT 3").all();
console.log('ПЦШ paths:', r1);
const r2 = db.prepare("SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%Цех ПЦБ%' LIMIT 3").all();
console.log('ПЦБ paths:', r2);
db.close();
