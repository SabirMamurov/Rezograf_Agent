const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

const products = db.prepare('SELECT * FROM Product').all();
const updateStmt = db.prepare(`
  UPDATE Product SET 
    composition = ?, 
    storageCond = ?, 
    nutritionalInfo = ?,
    certCode = ?
  WHERE id = ?
`);

let fixedCount = 0;

db.transaction(() => {
  for (const p of products) {
    // Collect all texts that might be merged. Sometimes they end up in composition, sometimes storageCond, etc.
    let fullText = [p.composition || '', p.storageCond || '', p.nutritionalInfo || ''].join(' ').replace(/\s+/g, ' ').trim();
    
    // Check if it's a merged text
    const hasComposition = /Состав[:\s]/i.test(fullText);
    const hasStorage = /Срок годности/i.test(fullText);
    const hasNutrition = /Пищевая ценность/i.test(fullText);
    const hasEnergy = /Энергетическая ценность/i.test(fullText);
    
    // If it has at least composition and storage or nutrition combined into one string
    // Let's parse it specifically
    if (fullText.length > 100 && hasStorage && (hasNutrition || hasEnergy)) {
      
      let newComp = p.composition || '';
      let newStorage = p.storageCond || '';
      let newNutr = p.nutritionalInfo || '';
      let newCert = p.certCode || '';

      // If everything is just shoved into one of the fields (usually composition or storageCond)
      // We will parse fullText and rebuild them.
      let remainingText = fullText;

      // Extract СТО / ГОСТ / ТУ from the end of the text if it exists
      const certMatch = remainingText.match(/(СТО|ТУ|ГОСТ)\s+[-\d\.]+/i);
      if (certMatch) {
         if (!newCert) {
             newCert = certMatch[0].trim();
         }
         remainingText = remainingText.replace(certMatch[0], '').trim();
      }

      // Try to split into 3 parts:
      // 1. Composition (from "Состав" to "Срок годности" or "Пищевая ценность")
      // 2. Storage ("Срок годности" to "Пищевая ценность")
      // 3. Nutrition ("Пищевая ценность" to the end)

      let storageIndex = remainingText.indexOf('Срок годности');
      if (storageIndex === -1) storageIndex = remainingText.indexOf('Хранить при');
      
      let nutrIndex = remainingText.indexOf('Пищевая ценность');
      if (nutrIndex === -1) nutrIndex = remainingText.indexOf('Энергетическая ценность');

      if (storageIndex !== -1 && nutrIndex !== -1 && storageIndex < nutrIndex) {
         // Good order: Co -> St -> Nu
         let compText = remainingText.substring(0, storageIndex).trim();
         let stText = remainingText.substring(storageIndex, nutrIndex).trim();
         let nuText = remainingText.substring(nutrIndex).trim();

         // clean up
         newComp = compText;
         newStorage = stText;
         newNutr = nuText;
      } else if (nutrIndex !== -1 && storageIndex !== -1 && nutrIndex < storageIndex) {
         // Rare order: Co -> Nu -> St
         let compText = remainingText.substring(0, nutrIndex).trim();
         let nuText = remainingText.substring(nutrIndex, storageIndex).trim();
         let stText = remainingText.substring(storageIndex).trim();
         
         newComp = compText;
         newStorage = stText;
         newNutr = nuText;
      } else if (storageIndex !== -1 && nutrIndex === -1) {
         let compText = remainingText.substring(0, storageIndex).trim();
         let stText = remainingText.substring(storageIndex).trim();
         newComp = compText;
         newStorage = stText;
      } else if (nutrIndex !== -1 && storageIndex === -1) {
         let compText = remainingText.substring(0, nutrIndex).trim();
         let nuText = remainingText.substring(nutrIndex).trim();
         newComp = compText;
         newNutr = nuText;
      }

      // If we extracted something new, update DB
      if (newComp !== p.composition || newStorage !== p.storageCond || newNutr !== p.nutritionalInfo) {
         // Minor cleanups
         if (newComp && newComp.length < 10 && !newComp.toLowerCase().includes('состав')) newComp = p.composition; // safety fallback

         updateStmt.run(newComp || null, newStorage || null, newNutr || null, newCert || null, p.id);
         fixedCount++;
         console.log(`Fixed product: ${p.name || p.sku}`);
      }
    }
  }
})();

console.log(`\nFixed ${fixedCount} label(s) with merged text blocks.`);
db.close();
