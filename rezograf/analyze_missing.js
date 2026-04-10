/**
 * Analyze WHY composition is missing from ~1100 labels
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

let templateOnly = 0, transportLabels = 0, shortLabels = 0, otherMissing = 0;
let withComp = 0;
const examples = { template: [], transport: [], short: [] };

for (const p of products) {
  const textObjs = p.objs.filter(o => o.type === 5 && o.value.length > 2 && !o.value.startsWith('(error'));
  const allText = textObjs.map(o => o.value).join(' ');
  
  const hasComp = /состав\s*:/i.test(allText) || textObjs.some(o => o.value.length > 100 && !/ООО|область|хранить|срок|масса|вес|дата/i.test(o.value));
  
  if (hasComp) {
    withComp++;
    continue;
  }
  
  // Why missing?
  const fname = p.path.split('\\').pop();
  const hasEmpty = textObjs.some(o => /^(Производитель|Вес нетто:|Вес брутто:)$/i.test(o.value.trim()));
  const isTransport = textObjs.some(o => /количество\s*шт|вес\s*места|коробок/i.test(o.value));
  const maxLen = Math.max(0, ...textObjs.map(o => o.value.length));
  
  if (hasEmpty) {
    templateOnly++;
    if (examples.template.length < 3) examples.template.push({ fname, texts: textObjs.map(o => o.value.substring(0, 60)) });
  } else if (isTransport) {
    transportLabels++;
    if (examples.transport.length < 3) examples.transport.push({ fname, texts: textObjs.map(o => o.value.substring(0, 60)) });
  } else if (maxLen < 60) {
    shortLabels++;
    if (examples.short.length < 3) examples.short.push({ fname, texts: textObjs.map(o => o.value.substring(0, 60)) });
  } else {
    otherMissing++;
  }
}

const totalMissing = templateOnly + transportLabels + shortLabels + otherMissing;

console.log('=========================================');
console.log('  ANALYSIS: Why composition is missing');
console.log('=========================================\n');
console.log(`Total products: ${products.length}`);
console.log(`WITH composition: ${withComp}`);
console.log(`WITHOUT composition: ${totalMissing}\n`);

console.log('--- BREAKDOWN ---\n');

console.log(`1. ШАБЛОНЫ-ЗАГОТОВКИ (поля-плейсхолдеры): ${templateOnly}`);
console.log('   Это пустые шаблоны с полями "Производитель", "Вес нетто:" — данные вводились при печати');
if (examples.template.length > 0) {
  console.log('   Примеры:');
  examples.template.forEach(e => console.log(`     "${e.fname}": ${JSON.stringify(e.texts)}`));
}

console.log(`\n2. ТРАНСПОРТНЫЕ ЭТИКЕТКИ (на короба): ${transportLabels}`);
console.log('   Фасовочные/транспортные этикетки — "Количество шт", "Вес места"');
if (examples.transport.length > 0) {
  console.log('   Примеры:');
  examples.transport.forEach(e => console.log(`     "${e.fname}": ${JSON.stringify(e.texts)}`));
}

console.log(`\n3. МАЛЕНЬКИЕ СТИКЕРЫ (весь текст < 60 символов): ${shortLabels}`);
console.log('   Мелкие наклейки с названием + весом, без места для состава');
if (examples.short.length > 0) {
  console.log('   Примеры:');
  examples.short.forEach(e => console.log(`     "${e.fname}": ${JSON.stringify(e.texts)}`));
}

console.log(`\n4. ПРОЧИЕ: ${otherMissing}`);
console.log('   Содержат текст, но состав не помечен словом "Состав:" и короткий');
