import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  await prisma.product.deleteMany({});
  console.log("Deleted all test products");
}

main().finally(() => prisma.$disconnect());
