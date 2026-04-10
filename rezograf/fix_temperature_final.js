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
    
    // Replace "(18±3)" with "+18 ± 3"
    // Handle any number
    newCond = newCond.replace(/\((\d+)\s*±\s*(\d+)\)/g, '+$1 ± $2');
    newCond = newCond.replace(/\+18\s*±\s*3/g, '+18 ± 3');
    
    // If they strictly want "+/-"
    // newCond = newCond.replace(/\+(\d+)\s*±\s*(\d+)/g, '+$1 +/- $2');
    // I'll keep ± but with spaces

    if (newCond !== p.storageCond) {
      updateStmt.run(newCond, p.id);
      updated++;
    }
  }
})();

console.log('Updated conditions:', updated);

const examples = db.prepare("SELECT storageCond FROM Product WHERE storageCond LIKE '%+18%' LIMIT 5").all();
console.log("Examples:");
examples.forEach(e => console.log(e.storageCond));

db.close();
