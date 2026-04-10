const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('prisma/dev.db');

db.all('SELECT id, name, category, btwFilePath FROM Product LIMIT 5', [], (err, rows) => {
    if (err) throw err;
    console.log(rows);
});
