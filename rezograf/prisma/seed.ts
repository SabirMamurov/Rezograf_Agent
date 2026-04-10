import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./prisma/dev.db");
const adapter = new PrismaBetterSqlite3(db);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Clear existing to avoid unique constraint errors during test
  await prisma.product.deleteMany({});
  await prisma.template.deleteMany({});

  // 1. Create a 90x70 Template
  const t9070 = await prisma.template.create({
    data: {
      name: "Крупная этикетка (90x70)",
      widthMm: 90,
      heightMm: 70,
    }
  });

  // 2. Create a 58x40 Template (Standard)
  const t5840 = await prisma.template.create({
    data: {
      name: "Стандартная (58x40)",
      widthMm: 58,
      heightMm: 40,
    }
  });

  // 3. Create Demo Products
  await prisma.product.create({
    data: {
      name: "Кедровая КОМЕТА классическая 1 кг",
      sku: "KM-001",
      barcodeEan13: "4620015650117",
      weight: "1000 г",
      composition: "Ядро кедрового ореха, мёд натуральный, патока, шоколадная глазурь (сахар, какао-масло, какао-порошок, эмульгатор лецитин).",
      nutritionalInfo: "белки - 12г, жиры - 38г, углеводы - 44г. Энерг.ценность: 570 ккал.",
      storageCond: "Хранить при температуре (18±3)°C и отн. влажности воздуха не более 75%.",
      templateId: t9070.id
    }
  });

  await prisma.product.create({
    data: {
      name: "Кедровые ПАЛОЧКИ без глазури",
      sku: "KP-002",
      barcodeEan13: "4620015650223",
      weight: "1 кг",
      composition: "Ядро кедрового ореха дробленное, мед натуральный цветочный, молоко сухое цельное.",
      nutritionalInfo: "белки - 14г, жиры - 42г, углеводы - 32г. Энерг.ценность: 560 ккал.",
      storageCond: "Хранить 6 месяцев.",
      templateId: t5840.id
    }
  });

  console.log("Seed data imported successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
