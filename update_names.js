const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('./prisma/dev.db');
const raw = fs.readFileSync('btw_all_data.txt', 'utf16le');
const lines = raw.split('\r\n');

let current = null;
const map = {};

for (const line of lines) {
  if (line.startsWith('FILE_START=')) {
    current = { path: line.substring(11), objs: [] };
  } else if (line.startsWith('OBJ|') && current) {
    const p = line.split('|');
    if (p.length > 4) {
      current.objs.push({ name: p[2], type: parseInt(p[3]), value: p.slice(4).join('|').trim() });
    }
  } else if (line === 'FILE_END' && current) {
    const texts = current.objs.filter(o => o.type === 5 && o.value.length > 3);
    const titleCandidates = texts.filter(o => {
      const v = o.value.toLowerCase();
      if (v.includes('изготовитель')) return false;
      if (v.includes('адрес')) return false;
      if (v.includes('состав:')) return false;
      if (v.includes('состав :')) return false;
      if (v.includes('масса нетто')) return false;
      if (v.includes('вес нетто')) return false;
      if (v.includes('срок годности')) return false;
      if (v.includes('пищевая ценность')) return false;
      if (v.includes('энергетическая ценность')) return false;
      if (v.includes('дата изготовления')) return false;
      if (v.includes('годен до')) return false;
      if (v.includes('сто ')) return false;
      if (v.includes('тел:')) return false;
      if (v.includes('тел.')) return false;
      if (v.includes('штрих-код')) return false;
      if (v.includes('возможны следы')) return false;
      if (v.includes('может содержать')) return false;
      if (/^\d{2}\.\d{2}\.\d{4}/.test(v)) return false;
      if (/^\d{4}$/.test(v)) return false;
      return true;
    });

    if (titleCandidates.length > 0) {
      const title = titleCandidates.sort((a,b) => b.value.length - a.value.length)[0].value;
      map[current.path] = title.replace(/\s+/g, ' ').trim();
    }
    current = null;
  }
}

let count = 0;
const products = db.prepare('SELECT id, btwFilePath, name FROM Product').all();
const stmt = db.prepare('UPDATE Product SET name = ? WHERE id = ?');
for (const p of products) {
  if (!p.btwFilePath) continue;
  let title = map[p.btwFilePath];
  // fallback if backward slashes
  if (!title) {
    const norm = p.btwFilePath.replace(/\//g, '\\');
    title = map[norm] || map[norm.replace(/\\\\/g, '\\')];
  }

  if (title && title !== p.name && title.length < 150) {
    console.log(`- ${p.name}`);
    console.log(`+ ${title}`);
    stmt.run(title, p.id);
    count++;
  }
}
console.log('Updated names:', count);
db.close();
