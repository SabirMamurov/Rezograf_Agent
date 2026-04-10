import { prisma } from "./src/lib/prisma";
import path from "node:path";

async function main() {
  const products = await prisma.product.findMany();
  let updatedCount = 0;

  for (const p of products) {
    if (p.btwFilePath) {
      // Extract filename from Windows path
      let rawName = path.win32.basename(p.btwFilePath, ".btw");
      
      // Some extensions might be uppercase .BTW
      if (rawName.toLowerCase().endsWith(".btw")) {
        rawName = rawName.slice(0, -4);
      }
      
      const newName = rawName.trim();

      if (newName && newName !== p.name) {
        await prisma.product.update({
          where: { id: p.id },
          data: { name: newName },
        });
        updatedCount++;
        console.log(`Updated: "${p.name}" -> "${newName}"`);
      }
    }
  }

  console.log(`\nSuccessfully updated names for ${updatedCount} products using their file names.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
