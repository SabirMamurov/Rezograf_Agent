// Scan all BarTender extractions for "extra" text objects that aren't
// captured by the standard import classifier (name, composition, weight,
// storage, manufacturer, address, quantity, sku, cert, dates, etc.).
// Goal: surface seasonal/promo markers like "Обечайка 8 Марта" that drop
// out during import.
const fs = require("fs");
const path = require("path");

const TXT_FILES = [
  "all_pco.txt",
  "all_pcb.txt",
  "all_pcsh.txt",
  "f1_mp.txt",
  "f2_mp_vesovie.txt",
  "f3_shk_gya.txt",
  "shk_only.txt",
].map((f) => path.join(__dirname, "..", "import_runs", f));

// Patterns we KNOW are captured by the importer. Anything matching these is
// "classified" and not counted as extra.
const CLASSIFIED = [
  /ООО|ИП.*тел|тел[\.: ].*\d/i,           // manufacturer/phone
  /^Изготовитель:/i,
  /\d{6}.*област/i,                      // postal address with region
  /^Адрес:/i,
  /Россия.*Томская|Россия,?\s*\d{6}/i,
  /хранить|срок\s*годн|температур.*хранен/i, // storage
  /^Срок годности/i,
  /вес\s*1\s*шт|масса\s*нетто|^масса\s|вес\s*места/i, // weight / box
  /^Вес\s*1/i,
  /количество\s*шт/i,                    // quantity
  /^Количество/i,
  /калорийн|энерг.*ценн|белк.*жир|пищев.*ценн|ккал/i, // nutrition
  /^состав\s*[:;]/i,                     // composition prefix
  /^(СТО|ГОСТ|ТУ)\s+[-\d.]+/i,          // cert
  /создано.*произведено|фонда\s*содействия/i, // sponsor
  /^\d{2}\.\d{2}\.\d{2,4}\.?$/,         // bare date
  /дата\s*(фасовки|изготовления|производства)/i,
  /номер\s*партии/i,
  /^изготовлено\s*(и|\/)\s*упаковано/i,
  /^изготовлено\s*(и|$)/i,
  /^упаковано\s*:?\s*$/i,
  /^тел[\.\s:]/i,                        // standalone phone
  /^Конфеты|^Орехи|^Мармелад|^Драже|^Финик|^Кедров|^Шоколад|^Набор|^Варенье|^Иван\s*чай|^Чайный/i,
  // Long product-name-like texts are caught as name/composition; skip.
];

const isShortNumeric = (v) => /^\d{1,7}$/.test(v); // SKU or short digits
const isDateLike = (v) => /^\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4}\.?$/.test(v);

function isClassified(val, objName) {
  if (!val) return true;
  if (val.startsWith("(error")) return true;
  if (isShortNumeric(val)) return true;
  if (isDateLike(val)) return true;
  // Текст 3 is typically the name — long text, classified
  if (objName === "Текст 3" && val.length > 30) return true;
  // Long values (composition-like) are likely caught
  if (val.length > 100) return true;
  for (const re of CLASSIFIED) if (re.test(val)) return true;
  return false;
}

const all = []; // { srcPath, extras: [{ objName, val }] }
for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), extras: [] };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue; // only text objects
      const objName = (parts[2] || "").trim();
      const val = parts.slice(4).join("|").trim();
      if (!val) continue;
      if (isClassified(val, objName)) continue;
      cur.extras.push({ objName, val });
    } else if (ln === "FILE_END" && cur) {
      if (cur.extras.length > 0) all.push(cur);
      cur = null;
    }
  }
}

console.log("Files with unclassified text: " + all.length);

// Aggregate by value
const byVal = new Map();
for (const f of all) {
  for (const e of f.extras) {
    const k = e.val;
    if (!byVal.has(k)) byVal.set(k, { count: 0, files: [], objNames: new Set() });
    const b = byVal.get(k);
    b.count++;
    b.objNames.add(e.objName);
    if (b.files.length < 5) b.files.push(f.src.split("\\").pop());
  }
}
console.log("Unique extra values: " + byVal.size);

const sorted = Array.from(byVal.entries()).sort((a, b) => b[1].count - a[1].count);
console.log("\n=== Top 30 unique extras (by occurrence) ===");
for (const [val, b] of sorted.slice(0, 30)) {
  console.log("  [" + b.count + "x] " + JSON.stringify(val) + "  (Текст: " + [...b.objNames].join(",") + ")");
  for (const f of b.files.slice(0, 2)) console.log("       — " + f);
}

console.log("\n=== Distinct values count breakdown ===");
const buckets = { once: 0, "2-5": 0, "6-20": 0, "21-100": 0, "100+": 0 };
for (const [, b] of byVal) {
  if (b.count === 1) buckets.once++;
  else if (b.count <= 5) buckets["2-5"]++;
  else if (b.count <= 20) buckets["6-20"]++;
  else if (b.count <= 100) buckets["21-100"]++;
  else buckets["100+"]++;
}
for (const k of Object.keys(buckets)) console.log("  " + k + ": " + buckets[k]);
