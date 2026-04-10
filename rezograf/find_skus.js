/**
 * Analyze BTW data to find SKU/article patterns and extract them.
 * Then update the database with extracted SKUs.
 */
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'btw_all_data.txt'), 'utf16le');
const lines = raw.split('\r\n');

// Parse all files with their objects
const files = [];
let current = null;
for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { filePath: line.substring(11), objects: [] };
  } else if (line.startsWith('OBJ|') && current) {
    const parts = line.split('|');
    current.objects.push({
      idx: parseInt(parts[1]),
      name: parts[2] || '',
      type: parseInt(parts[3]) || 0,
      value: parts.slice(4).join('|').trim(),
    });
  } else if (line === 'FILE_END') {
    if (current) { files.push(current); current = null; }
  }
}

console.log(`Total BTW files: ${files.length}\n`);

// Look for SKU patterns in object names and values
// Common SKU object names: "Текст N", but the VALUE is a short numeric code
// SKUs are typically 4-6 digit numbers that appear as standalone text objects
// Looking at the reference image, SKU "14315" is shown on the label

// Strategy: find text objects (type=5) whose value is a pure number 3-6 digits
// These are likely article/SKU codes
const skuCandidates = [];
const skuByFile = new Map();

for (const file of files) {
  const textObjs = file.objects.filter(o => o.type === 5);
  
  for (const obj of textObjs) {
    const val = obj.value.trim();
    
    // Pure numeric 3-6 digits — likely an SKU/article number
    if (/^\d{3,6}$/.test(val)) {
      // Exclude years (2020-2030) and dates
      if (/^20[2-3]\d$/.test(val)) continue;
      
      const key = path.basename(file.filePath);
      if (!skuByFile.has(file.filePath)) {
        skuByFile.set(file.filePath, []);
      }
      skuByFile.get(file.filePath).push({
        objName: obj.name,
        value: val,
      });
      
      if (skuCandidates.length < 30) {
        skuCandidates.push({
          file: key,
          objName: obj.name,
          value: val,
        });
      }
    }
  }
}

console.log(`Files with potential SKU numbers: ${skuByFile.size}`);
console.log(`\nSample SKU candidates:`);
skuCandidates.forEach(s => {
  console.log(`  File: ${s.file} | ObjName: "${s.objName}" | Value: ${s.value}`);
});

// Also check for objects named with "арт" or "SKU" or "Артикул"
console.log(`\n--- Objects with "артикул/арт/SKU" in name ---`);
let artCount = 0;
for (const file of files) {
  for (const obj of file.objects) {
    if (/артикул|арт\.|арт\s|sku/i.test(obj.name)) {
      if (artCount < 20) {
        console.log(`  File: ${path.basename(file.filePath)} | Obj: "${obj.name}" type=${obj.type} | Val: "${obj.value}"`);
      }
      artCount++;
    }
  }
}
console.log(`Total: ${artCount}`);

// Check what object names typically hold SKU-like values (3-6 digit pure numbers)
const objNameStats = {};
for (const [fp, skus] of skuByFile.entries()) {
  for (const s of skus) {
    objNameStats[s.objName] = (objNameStats[s.objName] || 0) + 1;
  }
}
console.log(`\nObject names that hold numeric codes (possible SKUs):`);
Object.entries(objNameStats).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
  console.log(`  "${name}": ${count} files`);
});

// Write the mapping for DB update
const skuMapping = [];
for (const [fp, skus] of skuByFile.entries()) {
  // Take the first SKU candidate per file
  if (skus.length > 0) {
    skuMapping.push({ btwFilePath: fp, sku: skus[0].value, objName: skus[0].objName });
  }
}

fs.writeFileSync(path.join(__dirname, 'sku_mapping.json'), JSON.stringify(skuMapping, null, 2), 'utf8');
console.log(`\nWrote ${skuMapping.length} SKU mappings to sku_mapping.json`);
