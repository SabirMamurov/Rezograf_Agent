const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const products = db.prepare('SELECT id, storageCond FROM Product WHERE storageCond IS NOT NULL').all();

let updated = 0;
const updateStmt = db.prepare('UPDATE Product SET storageCond = ? WHERE id = ?');

db.transaction(() => {
  for (const p of products) {
    let newCond = p.storageCond;
    
    // Fix redundancy: "при температуре t (18±3)" -> "при температуре (18±3)"
    newCond = newCond.replace(/при\s+температуре\s+t\s*\(/gi, 'при температуре (');
    newCond = newCond.replace(/при\s+t\s*\(/gi, 'при температуре (');
    newCond = newCond.replace(/\bтемпературе\s+t\s*\(/gi, 'температуре (');

    if (newCond !== p.storageCond) {
      updateStmt.run(newCond, p.id);
      updated++;
    }
  }
})();

console.log('Updated conditions:', updated);

const examples = db.prepare("SELECT storageCond FROM Product WHERE storageCond LIKE '%(18±3)%' LIMIT 5").all();
console.log("Examples:");
examples.forEach(e => console.log(e.storageCond));

db.close();
