/**
 * Show examples of the 194 "other" files where composition might be present
 * but wasn't detected by the parser.
 */
const fs = require('fs');
const raw = fs.readFileSync('btw_all_data.txt', 'utf16le');
const lines = raw.split('\r\n');

let current = null;
const products = [];

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { path: line.substring(11), objs: [] };
  } else if (line.startsWith('OBJ|') && current) {
    const p = line.split('|');
    current.objs.push({ name: p[2], type: parseInt(p[3]), value: p.slice(4).join('|').trim() });
  } else if (line === 'FILE_END' && current) {
    products.push(current);
    current = null;
  }
}

const otherExamples = [];

for (const p of products) {
  const textObjs = p.objs.filter(o => o.type === 5 && o.value.length > 2 && !o.value.startsWith('(error'));
  const allText = textObjs.map(o => o.value).join(' ');
  
  const hasCompKeyword = /состав\s*:/i.test(allText);
  const hasLongText = textObjs.some(o => o.value.length > 100 && !/ООО|область|хранить|срок|масса|вес|дата/i.test(o.value));
  const hasComp = hasCompKeyword || hasLongText;
  
  if (hasComp) continue;
  
  const hasEmpty = textObjs.some(o => /^(Производитель|Вес нетто:|Вес брутто:)$/i.test(o.value.trim()));
  const isTransport = textObjs.some(o => /количество\s*шт|вес\s*места|коробок/i.test(o.value));
  const maxLen = Math.max(0, ...textObjs.map(o => o.value.length));
  
  if (!hasEmpty && !isTransport && maxLen >= 60) {
    otherExamples.push(p);
  }
}

console.log(`Found ${otherExamples.length} "other" files\n`);

// Show first 15 examples with ALL their text objects
for (let i = 0; i < Math.min(15, otherExamples.length); i++) {
  const p = otherExamples[i];
  const fname = p.path.split('\\').pop();
  const textObjs = p.objs.filter(o => o.type === 5 && o.value.length > 2 && !o.value.startsWith('(error'));
  
  console.log(`\n=== ${i + 1}. ${fname} ===`);
  for (const o of textObjs) {
    const marker = o.value.length >= 60 ? ' *** LONG ***' : '';
    console.log(`  [${o.name}] (${o.value.length} ch)${marker}: ${o.value.substring(0, 200)}`);
  }
}
