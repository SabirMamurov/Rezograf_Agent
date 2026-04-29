// Import 3 new folders extracted via extract_folder_to.vbs.
// Reads BarTender dumps, classifies fields, remaps paths to extracted_labels
// virtual layout, and INSERTs into prisma/dev.db.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "prisma", "dev.db");
const DB_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";

// Each job: srcPrefix on P: → target prefix under extracted_labels.
// "preserve": keep relative path under srcPrefix verbatim.
// "flatten": drop everything under srcPrefix, keep just basename.
const JOBS = [
  {
    label: "F1 МП",
    txt: path.join(ROOT, "import_runs", "f1_mp.txt"),
    srcPrefix: "P:\\Rizograf\\От Салаховой\\МП\\",
    targetPrefix: DB_PREFIX + "МП\\",
    mode: "preserve",
  },
  {
    label: "F2 МП Весовые",
    txt: path.join(ROOT, "import_runs", "f2_mp_vesovie.txt"),
    srcPrefix: "P:\\Rizograf\\От Салаховой\\Цех ПЦО\\МП Весовые\\",
    targetPrefix: DB_PREFIX + "Цех ПЦО\\МП Весовые\\",
    mode: "preserve",
  },
  {
    label: "F3 ШК ГЯ новые артикулы",
    txt: path.join(ROOT, "import_runs", "f3_shk_gya.txt"),
    srcPrefix:
      "P:\\Rizograf\\От Салаховой\\Цех ПЦО\\Конфеты\\Конфеты\\Шоу-боксы\\Шоу бокс Редизайн с Апрель 2022\\ШБ ТУЛА\\ШК ГЯ новые артикулы\\",
    targetPrefix: DB_PREFIX + "Цех ПЦО\\Конфеты\\",
    mode: "flatten",
  },
];

function parseDump(file) {
  const raw = fs.readFileSync(file, "utf16le");
  // Strip BOM if present
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/);
  const entries = [];
  let cur = null;
  let openErrCount = 0;
  for (const line of lines) {
    if (line.startsWith("FILE_START=")) {
      cur = { filePath: line.slice(11), objs: [], openError: null };
    } else if (line.startsWith("OPEN_ERROR=")) {
      if (cur) cur.openError = line.slice(11);
      openErrCount++;
    } else if (line.startsWith("OBJ|") && cur) {
      const parts = line.split("|");
      cur.objs.push({
        idx: parseInt(parts[1]) || 0,
        name: (parts[2] || "").trim(),
        type: parseInt(parts[3]) || 0,
        value: parts.slice(4).join("|").trim(),
      });
    } else if (line === "FILE_END") {
      if (cur) entries.push(cur);
      cur = null;
    }
  }
  return { entries, openErrCount };
}

function remapPath(srcPath, job) {
  if (!srcPath.startsWith(job.srcPrefix)) {
    // Defensive: if BarTender lowercased a drive letter or something, try CI match
    const idx = srcPath.toLowerCase().indexOf(job.srcPrefix.toLowerCase());
    if (idx === 0) {
      const tail = srcPath.slice(job.srcPrefix.length);
      if (job.mode === "flatten") return job.targetPrefix + tail.split("\\").pop();
      return job.targetPrefix + tail;
    }
    return null;
  }
  const tail = srcPath.slice(job.srcPrefix.length);
  if (job.mode === "flatten") return job.targetPrefix + tail.split("\\").pop();
  return job.targetPrefix + tail;
}

function classify(entry) {
  const fileName = path.basename(entry.filePath, ".btw").trim();
  const textObjs = entry.objs.filter(
    (o) => o.type === 5 && o.value.length > 2 && !o.value.startsWith("(error"),
  );
  const barcodeObjs = entry.objs.filter((o) => o.type === 4 && o.value.length > 0);

  let name = "";
  let composition = "";
  let weight = "";
  let storageCond = "";
  let nutritionalInfo = "";
  let manufacturer = "";
  let barcodeEan13 = "";
  let sku = "";
  let certCode = "";
  let quantity = "";
  let boxWeight = "";
  let sponsorText = "";

  for (const obj of barcodeObjs) {
    const v = obj.value.trim();
    if (/^\d{8,14}$/.test(v) && !barcodeEan13) barcodeEan13 = v;
  }

  const unclassified = [];
  for (const obj of textObjs) {
    const val = obj.value;

    if (/ООО|ИП/i.test(val) && /тел|фабрик|завод|компани/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + "; " + val : val;
      continue;
    }
    if (/^\d{6}[,\s]+Росси/i.test(val) || /область.*район/i.test(val)) {
      manufacturer = manufacturer ? manufacturer + "; " + val : val;
      continue;
    }
    if (/хранить|срок\s*годн|температур.*хранен/i.test(val) && val.length > 15) {
      storageCond = val;
      continue;
    }
    if (/вес\s*1\s*шт|масса\s*нетто\s*[:\d]|^масса\s/i.test(val) && val.length < 80) {
      weight = val;
      continue;
    }
    if (/вес\s*места/i.test(val)) {
      boxWeight = val;
      continue;
    }
    if (/количество\s*шт/i.test(val)) {
      quantity = val;
      continue;
    }
    if (/калорийн|энерг.*ценн|белк.*жир|пищев.*ценн|ккал/i.test(val) && val.length > 20) {
      nutritionalInfo = val;
      continue;
    }
    if (
      /^состав\s*[:;]/i.test(val) ||
      (val.length > 100 && /сахар|мука|масло|мед|орех|какао/i.test(val))
    ) {
      composition = val;
      continue;
    }
    if (/^\d{3,6}$/.test(val) && !sku) {
      sku = val;
      continue;
    }
    if (/^(СТО|ГОСТ|ТУ)\s+[-\d.]+/i.test(val)) {
      certCode = val;
      continue;
    }
    if (/создано.*произведено|фонда\s*содействия/i.test(val)) {
      sponsorText = val;
      continue;
    }
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) continue;
    if (/дата\s*(фасовки|изготовления|производства)/i.test(val)) continue;
    if (/номер\s*партии/i.test(val)) continue;
    if (/^изготовлено\s*(и|$)/i.test(val)) continue;

    unclassified.push({ name: obj.name, value: val, len: val.length });
  }

  const isBadText = (s) => {
    if (!s || s.length < 5 || s.length > 200) return true;
    if (/^\s*\d{2}\.\d{2}\.\d{2,4}\.?\s*$/.test(s)) return true;
    return /ООО "|^ИП\s|област|хранить|срок\s*годн|^масса|^\s*вес|дата|количество\s*шт|упаковано|шоу\s*бокс|создано|произведено|разработано|фонда|^тел\.\s|^состав|изготовлено/i.test(
      s,
    );
  };
  const t3 = textObjs.find((o) => o.name === "Текст 3");
  if (t3 && !isBadText(t3.value)) name = t3.value.trim();
  else {
    const cand = unclassified.filter(
      (o) =>
        o.len >= 5 && o.len <= 150 && o.value !== composition && !isBadText(o.value),
    );
    if (cand.length > 0) name = cand[0].value;
  }
  if (!name || isBadText(name)) name = fileName;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(name)) name = fileName;

  if (!composition) {
    const longTexts = unclassified
      .filter(
        (o) => o.len > 80 && !/област|россия.*район|изготовител|хранить|срок/i.test(o.value),
      )
      .sort((a, b) => b.len - a.len);
    if (longTexts.length > 0) composition = longTexts[0].value;
  }

  return {
    name,
    sku: sku || null,
    composition: composition || null,
    weight: weight || null,
    storageCond: storageCond || null,
    nutritionalInfo: nutritionalInfo || null,
    manufacturer: manufacturer || null,
    barcodeEan13: barcodeEan13 || null,
    certCode: certCode || null,
    quantity: quantity || null,
    boxWeight: boxWeight || null,
    sponsorText: sponsorText || null,
  };
}

function deriveCategoryFromTarget(targetPath) {
  // category/subcategory from target path under extracted_labels
  const after = targetPath.slice(DB_PREFIX.length).split("\\");
  // Drop the basename
  const dirs = after.slice(0, -1);
  return {
    category: dirs[0] || null,
    subcategory: dirs[1] || null,
  };
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const db = new Database(DB_PATH);
const existingPaths = new Set(
  db.prepare("SELECT btwFilePath FROM Product WHERE btwFilePath IS NOT NULL").all().map((r) => r.btwFilePath),
);
const tpl = db.prepare("SELECT id FROM Template LIMIT 1").get();
const templateId = tpl ? tpl.id : null;

const insert = db.prepare(`
  INSERT INTO Product (id, name, sku, category, subcategory, composition, weight, nutritionalInfo,
    storageCond, manufacturer, barcodeEan13, btwFilePath, certCode, quantity, boxWeight, sponsorText,
    templateId, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const samplesPerJob = {};
const totalsByJob = {};
const now = new Date().toISOString();

const txAll = db.transaction(() => {
  for (const job of JOBS) {
    console.log(`\n=== ${job.label} ===`);
    const { entries, openErrCount } = parseDump(job.txt);
    console.log(`  Parsed entries: ${entries.length}, OPEN_ERROR: ${openErrCount}`);

    let imported = 0;
    let skippedDup = 0;
    let skippedOpenErr = 0;
    let skippedRemap = 0;
    samplesPerJob[job.label] = [];

    for (const entry of entries) {
      if (entry.openError) {
        skippedOpenErr++;
        continue;
      }
      const newPath = remapPath(entry.filePath, job);
      if (!newPath) {
        skippedRemap++;
        continue;
      }
      if (existingPaths.has(newPath)) {
        skippedDup++;
        continue;
      }
      const fields = classify(entry);
      const cat = deriveCategoryFromTarget(newPath);

      insert.run(
        uuid(),
        fields.name,
        fields.sku,
        cat.category,
        cat.subcategory,
        fields.composition,
        fields.weight,
        fields.nutritionalInfo,
        fields.storageCond,
        fields.manufacturer,
        fields.barcodeEan13,
        newPath,
        fields.certCode,
        fields.quantity,
        fields.boxWeight,
        fields.sponsorText,
        templateId,
        now,
        now,
      );
      existingPaths.add(newPath);
      imported++;

      if (samplesPerJob[job.label].length < 8) {
        samplesPerJob[job.label].push({
          src: entry.filePath,
          newPath,
          name: fields.name,
          sku: fields.sku,
          ean: fields.barcodeEan13,
          comp: (fields.composition || "").slice(0, 80),
          weight: fields.weight,
        });
      }
    }
    totalsByJob[job.label] = { imported, skippedDup, skippedOpenErr, skippedRemap };
    console.log(`  Imported: ${imported}`);
    console.log(`  Skipped (dup btwFilePath): ${skippedDup}`);
    console.log(`  Skipped (open error): ${skippedOpenErr}`);
    console.log(`  Skipped (path remap fail): ${skippedRemap}`);
  }
});

txAll();

console.log("\n=== SAMPLES (first 8 per job) ===");
for (const job of JOBS) {
  console.log(`\n--- ${job.label} ---`);
  for (const s of samplesPerJob[job.label]) {
    console.log(`  • ${s.name}`);
    console.log(`     sku=${s.sku || "-"}  ean=${s.ean || "-"}  weight=${s.weight || "-"}`);
    console.log(`     comp=${s.comp || "-"}`);
    console.log(`     path → ${s.newPath}`);
  }
}

console.log("\n=== TOTALS ===");
for (const job of JOBS) {
  const t = totalsByJob[job.label];
  console.log(`  ${job.label}: imported=${t.imported}, dup=${t.skippedDup}, openErr=${t.skippedOpenErr}, remapErr=${t.skippedRemap}`);
}

const dbTotalAfter = db.prepare("SELECT COUNT(*) AS n FROM Product").get().n;
console.log(`\nDB total products after import: ${dbTotalAfter}`);

// Quick folder tree counts under new prefixes
for (const prefix of [DB_PREFIX + "МП\\", DB_PREFIX + "Цех ПЦО\\МП Весовые\\", DB_PREFIX + "Цех ПЦО\\Конфеты\\"]) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM Product WHERE btwFilePath LIKE ?").get(prefix + "%").n;
  console.log(`  under "${prefix}": ${n}`);
}

db.close();
