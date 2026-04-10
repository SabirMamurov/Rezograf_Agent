const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const rawDataPath = path.join(__dirname, 'btw_all_data.txt');
if (!fs.existsSync(rawDataPath)) {
  console.log('No raw data found');
  process.exit(1);
}

const raw = fs.readFileSync(rawDataPath, 'utf16le');
const lines = raw.split('\r\n');

// Build mapping from filepath to CТО/ГОСТ/ТУ
const certs = new Map();
let currentFile = null;

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    currentFile = line.substring('FILE_START='.length);
  } else if (line.startsWith('OBJ|') && currentFile) {
    const parts = line.split('|');
    const value = parts.slice(4).join('|').trim();
    
    // Look for standards
    const match = value.match(/^(СТО|ГОСТ|ТУ)\s+[-\d\.]+/i);
    if (match) {
      certs.set(currentFile, match[0]); // store the exact standard name and number
    }
  } else if (line === 'FILE_END') {
    currentFile = null;
  }
}

console.log(`Found ${certs.size} certificates from original files.`);

const updateStmt = db.prepare('UPDATE Product SET certCode = ? WHERE btwFilePath = ?');
let updated = 0;

db.transaction(() => {
  for (const [filePath, certCode] of certs.entries()) {
    const res = updateStmt.run(certCode, filePath);
    if (res.changes > 0) updated++;
  }
})();

console.log(`Updated ${updated} products in database with certCode.`);
db.close();
