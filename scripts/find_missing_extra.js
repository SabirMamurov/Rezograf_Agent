// Scan BarTender extractions for "extra label tag" candidates and compare
// against the current Product.extraText column. Reports rows that have a
// tag in the source .btw but null/empty in DB.
//
// Tag = short text object that:
//   - is not a number / date / cert / phone / address
//   - is not the product name / composition / storage / weight / quantity
//   - is not the single "Э" export mark
//
// Output goes to import_runs/missing_extra_text.csv for review.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const TXT_FILES = ["all_pco.txt","all_pcb.txt","all_pcsh.txt","f1_mp.txt","f2_mp_vesovie.txt","f3_shk_gya.txt","shk_only.txt"]
  .map((f) => path.join(ROOT, "import_runs", f));

// Patterns that, when matched, mark a text as "already classified somewhere
// else" — we DON'T want to capture these as marketplace/seasonal tags.
const CLASSIFIED = [
  /^ООО|^ИП[\s.]/i,
  /Изготовитель:/i,
  /^Производитель:/i,
  /^Адрес:/i,
  /^Россия|^634\d{3}/,
  /\d{6}.*област/i,
  /^тел[\s.:]/i,
  /^Тел[\s.:]/i,
  /\(\d{3,4}\)\s*\d{2,3}-\d{2,3}/,
  /хранить|срок\s*годн|температур.*хранен/i,
  /^Срок годности/i,
  /^Вес\s*1|^Вес\s*нетто|^Масса\s*нетто|вес\s*места|вес\s*брутто|^Вес\s+\d|^Масса\s|^Вес:\s/i,
  /^Количество\s*шт|^\(количество\s*шт/i,
  /^Количество,\s*шт/i,
  /калорийн|энерг.*ценн|^Белк|^Жир|^Углевод|^ккал|^Пищев/i,
  /^Состав\s*[:;]/i,
  /^(СТО|ГОСТ|ТУ)\s+\d/i,
  /создано.*произведено|фонда\s*содействия/i,
  /^\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4}\.?$/,         // bare date
  /^Изготовлено\s*(и|\/)?\s*(упаковано)?/i,
  /^Дата\s*(фасовки|изготовлени|производства)/i,
  /^Номер\s*партии/i,
  /^Упаковано/i,
  /^шоу\s*бокс\s*\(/i,     // "шоу бокс (2 шт *540 г)"
  /^\(шоу-бокс/i,           // "(шоу-бокс/585 г)"
];

// Words that strongly suggest the value is a product name (not a tag).
// We drop anything starting with these, since the operator typically
// duplicates the name into Текст 12 / Текст 11 in the BarTender template.
const PRODUCT_NAME_PREFIXES = [
  /^Конфеты\s/i,
  /^Орехи\s+кедровые/i,
  /^Набор\s+конфет/i,
  /^Варенье\s+/i,
  /^Мармелад\s/i,
  /^Шоколад/i,
  /^Пастила\s/i,
  /^Драже\s/i,
  /^Финик/i,
  /^Халва\s/i,
  /^Чайный/i,
  /^Иван\s*чай/i,
  /^Кедровый\s+(грильяж|марципан|трюфель)/i,
  /^Кедровое\s+(золото|ассорти|зерно)/i,
  /^Кедровая\s+(шкатулка|комета|метелица|шишка|пастила|фантазия)/i,
  /^Кедровые\s+палочки/i,
  /^Сосновый\s+сироп/i,
  /^Цукаты/i,
  /^Ягоды/i,
];

const isClassified = (val, objName) => {
  if (!val) return true;
  if (val.startsWith("(error")) return true;
  if (/^\d{1,7}$/.test(val)) return true; // pure SKU/year
  if (/^\d{2}[\.\/]\d{2}[\.\/]\d{2,4}\.?$/.test(val)) return true;
  if (val.length > 60) return true;        // composition/storage already caught
  if (val === "Э" || /^Э\s*$/.test(val)) return true; // isExport handled
  if (objName === "Текст 3" && val.length > 30) return true; // product name
  // Standalone cert prefix without a number — fragment of certCode field
  if (/^(СТО|ГОСТ|ТУ)$/i.test(val)) return true;
  // Cert NUMBER fragments (split out of СТО/ГОСТ line by BarTender)
  if (/^\d{6,8}-\d{1,4}-\d{4}$/.test(val)) return true;  // e.g. 97585510-049-2022
  if (/^\d{5}-\d{4}$/.test(val)) return true;            // e.g. 31852-2012
  // BarTender placeholder like {1200}
  if (/^\{[^}]+\}$/.test(val)) return true;
  // Bare "шоу-бокс" / "шоу-бокс/..." — packaging info caught elsewhere
  if (/^шоу[-\s]?бокс/i.test(val)) return true;
  // Product variant names that often appear as Текст 12 mirror of the name
  if (/^(Драже|Кешью|Жмых|Паста\s+из|Ягодная|Ядро\s+КО|Тёмный|Тем(ный|ная))/i.test(val)) return true;
  // Manufacturer text fragments without trailing colon
  if (/^Изготовитель\s/i.test(val)) return true;
  if (/^Адрес\s/i.test(val)) return true;
  // Weight / mass label fragments
  if (/^Масса:|^Вес\s*-\s*нетто|^Вес\s*-|^Вес,/i.test(val)) return true;
  // Header labels with trailing colon — operator data lines, not tags
  if (/:\s*$/.test(val)) return true;
  // Old weight format "X гр.старый"
  if (/гр\.?\s*старый$/i.test(val)) return true;
  for (const re of CLASSIFIED) if (re.test(val)) return true;
  for (const re of PRODUCT_NAME_PREFIXES) if (re.test(val)) return true;
  return false;
};

// Drop "candidate" if it overlaps significantly with the product's `name` —
// catches duplicate-name Текст 12/Текст 11 objects we didn't anticipate.
function isLikelyDuplicateName(candidate, productName) {
  if (!productName || !candidate) return false;
  const a = (candidate || "").toLowerCase().replace(/[«»"'.,]+/g, "").trim();
  const b = (productName || "").toLowerCase().replace(/[«»"'.,]+/g, "").trim();
  if (a.length < 8) return false; // short tags like "МШ", "OZON" never duplicates
  if (a === b) return true;
  if (a.length > 12 && (b.includes(a) || a.includes(b))) return true;
  // Word-overlap heuristic: ≥3 distinct words shared and ≥50% of candidate words in name
  const wa = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const wb = new Set(b.split(/\s+/));
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  if (wa.size >= 3 && shared / wa.size >= 0.5) return true;
  return false;
}

// Normalize for fuzzy comparison so "OZON" matches "OZON " or "ozon"
const norm = (s) => (s || "").toLowerCase().replace(/[\s«»"'.,;:]+/g, "").trim();

// Index extractions: basename(lowercase) -> [{ objName, val }]
const sourceByBase = new Map();
for (const f of TXT_FILES) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf16le");
  const stripped = raw.charCodeAt(0)===0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    if (ln.startsWith("FILE_START=")) cur = { src: ln.slice(11), candidates: [] };
    else if (ln.startsWith("OBJ|") && cur) {
      const parts = ln.split("|");
      const type = parseInt(parts[3]) || 0;
      if (type !== 5) continue;
      const objName = (parts[2] || "").trim();
      const val = parts.slice(4).join("|").trim();
      if (val && !isClassified(val, objName)) cur.candidates.push({ objName, val });
    } else if (ln === "FILE_END" && cur) {
      if (cur.candidates.length > 0) {
        const base = cur.src.split("\\").pop().toLowerCase();
        if (!sourceByBase.has(base)) sourceByBase.set(base, cur.candidates);
      }
      cur = null;
    }
  }
}
console.log("Source files with extra candidates: " + sourceByBase.size);

// Match against DB
const db = new Database(path.join(ROOT, "prisma", "dev.db"), { readonly: true });
const rows = db.prepare("SELECT id, name, sku, btwFilePath, extraText FROM Product WHERE name <> '_folder_marker' AND btwFilePath IS NOT NULL").all();

const missing = [];
const valueCounts = new Map();
for (const r of rows) {
  const base = r.btwFilePath.split("\\").pop().toLowerCase();
  const cands = sourceByBase.get(base);
  if (!cands || cands.length === 0) continue;
  const currentExtraNorm = norm(r.extraText);
  // Find a tag in source that's not already in DB extraText
  for (const c of cands) {
    const cNorm = norm(c.val);
    if (!cNorm) continue;
    if (isLikelyDuplicateName(c.val, r.name)) continue;
    // Already there?
    if (currentExtraNorm && (currentExtraNorm === cNorm || currentExtraNorm.includes(cNorm) || cNorm.includes(currentExtraNorm))) continue;
    missing.push({
      id: r.id,
      sku: r.sku || "-",
      name: (r.name || "").slice(0, 60),
      currentExtra: r.extraText || "(empty)",
      sourceTag: c.val,
      objName: c.objName,
      file: base,
    });
    valueCounts.set(c.val, (valueCounts.get(c.val) || 0) + 1);
    break; // one suggestion per product
  }
}

console.log("Products with missing extraText candidate: " + missing.length);

// Distinct values
console.log("\n=== Top 40 most common candidate tags ===");
const sorted = [...valueCounts.entries()].sort((a,b)=>b[1]-a[1]);
for (const [val, n] of sorted.slice(0, 40)) {
  console.log("  [" + n + "x] " + JSON.stringify(val));
}

// CSV output
const csvLines = ["product_id;sku;name;current_extra;source_tag;obj_name;file"];
for (const m of missing) {
  csvLines.push([m.id, m.sku, m.name.replace(/;/g,","), JSON.stringify(m.currentExtra).slice(0,40).replace(/;/g,","), JSON.stringify(m.sourceTag).slice(0,60).replace(/;/g,","), m.objName, m.file.replace(/;/g,",")].join(";"));
}
const out = path.join(ROOT, "import_runs", "missing_extra_text.csv");
fs.writeFileSync(out, "﻿" + csvLines.join("\r\n"), "utf8");
console.log("\nWritten CSV: " + out);
