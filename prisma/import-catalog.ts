/**
 * Import products from products_catalog.csv into the database.
 * Run: npx tsx prisma/import-catalog.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "fs";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  const csvPath = path.join(process.cwd(), "products_catalog.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  // Skip header
  const header = lines[0];
  console.log("Header:", header);
  const dataLines = lines.slice(1);
  console.log(`Found ${dataLines.length} products to import`);

  // Clear existing data
  await prisma.product.deleteMany({});
  await prisma.template.deleteMany({});

  // Create default template (90x70mm)
  const defaultTemplate = await prisma.template.create({
    data: { name: "Основная этикетка (90×70 мм)", widthMm: 90, heightMm: 70 },
  });
  console.log(`Created template: ${defaultTemplate.name} (${defaultTemplate.id})`);

  let imported = 0;
  let errors = 0;

  for (const line of dataLines) {
    try {
      const fields = parseCsvLine(line);
      // id, category, subcategory, name, weight, fullpath
      const [, category, subcategory, name, weight, fullpath] = fields;

      if (!name || name.trim().length === 0) continue;

      await prisma.product.create({
        data: {
          name: name.trim(),
          category: category?.trim() || null,
          subcategory: subcategory?.trim() || null,
          weight: weight?.trim() || null,
          btwFilePath: fullpath?.trim() || null,
          templateId: defaultTemplate.id,
        },
      });
      imported++;

      if (imported % 100 === 0) {
        console.log(`  ... imported ${imported} products`);
      }
    } catch (e: unknown) {
      errors++;
      if (errors <= 5) {
        console.error(`Error on line: ${line.substring(0, 80)}...`, e);
      }
    }
  }

  console.log(`\n✅ Import complete: ${imported} products imported, ${errors} errors`);
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
