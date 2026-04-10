const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const products = db.prepare('SELECT id, storageCond FROM Product WHERE storageCond IS NOT NULL').all();

let updated = 0;
const updateStmt = db.prepare('UPDATE Product SET storageCond = ? WHERE id = ?');

db.transaction(() => {
  for (const p of products) {
    // Basic regex for formats like "от +18 +/- 3 °С", "при температуре 18+/-3 C", "t +18 +/- 3"
    let newCond = p.storageCond.replace(
      /(?:от\s*\+?|при температуре\s*\+?|при\s*t\s*\+?|t\s*\+?)(\d+)\s*(?:\+\/-|\+ \/ -|±)\s*(\d+)\s*°?\s*[CСcс]/gi, 
      't ($1±$2) °C'
    );
    
    // Sometimes it's just "18 +/- 3 C"
    newCond = newCond.replace(
      /(?:\s|^)\+?(\d+)\s*(?:\+\/-|\+ \/ -|±)\s*(\d+)\s*°?\s*[CСcс]/gi,
      ' t ($1±$2) °C'
    );

    // Minor cleanups
    newCond = newCond.replace(/t\s+\((\d+)±(\d+)\)\s+°C/g, 't ($1±$2) °C');
    
    // Trim extra spaces
    newCond = newCond.replace(/\s{2,}/g, ' ').trim();

    if (newCond !== p.storageCond) {
      updateStmt.run(newCond, p.id);
      updated++;
    }
  }
})();

console.log('Updated conditions:', updated);

const examples = db.prepare("SELECT storageCond FROM Product WHERE storageCond LIKE '%t (%±%) °C%' LIMIT 5").all();
console.log("Examples:");
examples.forEach(e => console.log(e.storageCond));

db.close();
