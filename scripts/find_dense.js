const Database = require('better-sqlite3');
const db = new Database('./prisma/dev.db');

const rows = db.prepare(`
  SELECT id, name, sku,
    LENGTH(COALESCE(composition,'')) + 
    LENGTH(COALESCE(nutritionalInfo,'')) + 
    LENGTH(COALESCE(storageCond,'')) + 
    LENGTH(COALESCE(weight,'')) + 
    LENGTH(COALESCE(certCode,'')) + 
    LENGTH(COALESCE(quantity,'')) + 
    LENGTH(COALESCE(boxWeight,'')) + 
    LENGTH(COALESCE(sponsorText,'')) as totalLen,
    LENGTH(COALESCE(composition,'')) as compLen
  FROM Product 
  ORDER BY totalLen DESC 
  LIMIT 10
`).all();

rows.forEach((r, i) => {
  console.log(`${i+1}. [${r.sku}] ${r.name} (всего ${r.totalLen} симв., состав ${r.compLen} симв.)`);
});
