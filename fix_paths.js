const db = require('better-sqlite3')('prisma/dev.db');

// Fix nested folder paths: remove the duplicate inner folder
// "...\Цех ПЦШ\ЦЕХ ПЦШ\..." -> "...\Цех ПЦШ\..."
// "...\Цех ПЦБ\Цех ПЦБ\..." -> "...\Цех ПЦБ\..."

const fixes = [
  { search: '\\Цех ПЦШ\\ЦЕХ ПЦШ\\', replace: '\\Цех ПЦШ\\' },
  { search: '\\Цех ПЦБ\\Цех ПЦБ\\', replace: '\\Цех ПЦБ\\' },
];

const updateStmt = db.prepare('UPDATE Product SET btwFilePath = ? WHERE id = ?');
const allProducts = db.prepare('SELECT id, btwFilePath FROM Product').all();

let fixed = 0;
db.transaction(() => {
  for (const p of allProducts) {
    if (!p.btwFilePath) continue;
    let newPath = p.btwFilePath;
    for (const f of fixes) {
      if (newPath.includes(f.search)) {
        newPath = newPath.replace(f.search, f.replace);
      }
    }
    if (newPath !== p.btwFilePath) {
      updateStmt.run(newPath, p.id);
      fixed++;
    }
  }
})();

console.log(`Fixed ${fixed} paths.`);

// Verify
const sample1 = db.prepare("SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%Цех ПЦШ%' LIMIT 2").all();
const sample2 = db.prepare("SELECT btwFilePath FROM Product WHERE btwFilePath LIKE '%Цех ПЦБ%' LIMIT 2").all();
console.log('ПЦШ samples:', sample1);
console.log('ПЦБ samples:', sample2);

db.close();
