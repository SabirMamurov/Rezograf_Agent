/**
 * Import classified_products.json into the Prisma SQLite database.
 * Run: npx tsx prisma/import-classified.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "fs";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

interface ClassifiedProduct {
  name: string;
  category: string | null;
  subcategory: string | null;
  composition: string | null;
  weight: string | null;
  storageCond: string | null;
  nutritionalInfo: string | null;
  manufacturer: string | null;
  barcodeEan13: string | null;
  btwFilePath: string;
}

async function main() {
  const jsonPath = path.join(process.cwd(), "classified_products.json");
  const products: ClassifiedProduct[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${products.length} classified products`);

  // Clear existing data
  console.log("Clearing existing data...");
  await prisma.product.deleteMany({});
  await prisma.template.deleteMany({});

  // Create default template
  const template = await prisma.template.create({
    data: { name: "Основная этикетка (90×70 мм)", widthMm: 90, heightMm: 70 },
  });
  console.log(`Created template: ${template.name}`);

  let imported = 0;
  let errors = 0;

  for (const p of products) {
    try {
      await prisma.product.create({
        data: {
          name: p.name,
          category: p.category,
          subcategory: p.subcategory,
          composition: p.composition,
          weight: p.weight,
          storageCond: p.storageCond,
          nutritionalInfo: p.nutritionalInfo,
          manufacturer: p.manufacturer,
          barcodeEan13: p.barcodeEan13,
          btwFilePath: p.btwFilePath,
          templateId: template.id,
        },
      });
      imported++;
      if (imported % 200 === 0) console.log(`  ... imported ${imported}`);
    } catch (e: unknown) {
      errors++;
      if (errors <= 3) console.error(`Error importing "${p.name}":`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\n✅ Import complete: ${imported} imported, ${errors} errors`);

  // Stats
  const total = await prisma.product.count();
  const withComp = await prisma.product.count({ where: { composition: { not: null } } });
  const withBarcode = await prisma.product.count({ where: { barcodeEan13: { not: null } } });
  const withWeight = await prisma.product.count({ where: { weight: { not: null } } });
  const withStorage = await prisma.product.count({ where: { storageCond: { not: null } } });

  console.log(`\n📊 Database stats:`);
  console.log(`  Total: ${total}`);
  console.log(`  With composition: ${withComp}`);
  console.log(`  With barcode: ${withBarcode}`);
  console.log(`  With weight: ${withWeight}`);
  console.log(`  With storage: ${withStorage}`);
}

main()
  .catch((e) => { console.error("Fatal:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
