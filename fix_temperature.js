const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const products = await prisma.product.findMany();
  let updated = 0;
  for (const p of products) {
    if (!p.storageCond) continue;
    // We want to match variations like:
    // "от +18 +/- 3 °С", "от 18 +/- 3 С", "при температуре 18+/-3 C"
    const newCond = p.storageCond.replace(/(?:от\s*\+?|при температуре\s*\+?|при\s*t\s*\+?)(\d+)\s*(?:\+\/-|\+ \/ -|±)\s*(\d+)\s*°?\s*[CСcс]/gi, 't ($1±$2) °C');
    
    // Also let's fix any standalone "+/-" that wasn't caught
    const newCond2 = newCond.replace(/\+/g, '+').replace(/\+ \/ -/g, '±').replace(/\+\/-/g, '±');
    
    let finalCond = newCond2;
    // Convert "от 18±3 °C" to "t (18±3) °C" if they just have ±
    finalCond = finalCond.replace(/от\s*\+?(\d+)\s*±\s*(\d+)\s*°?\s*[CСcс]/gi, 't ($1±$2) °C');
    // Convert "18±3" to "t (18±3) °C"  (Wait, might be too aggressive)
    
    if (finalCond !== p.storageCond) {
      await prisma.product.update({ where: { id: p.id }, data: { storageCond: finalCond } });
      updated++;
    }
  }
  console.log('Updated conditions:', updated);
  
  const examples = await prisma.product.findMany({
      where: { storageCond: { contains: 't (' } },
      take: 5
  });
  console.log("Examples:");
  console.log(examples.map(e => e.storageCond));

  await prisma.$disconnect();
}

fix().catch(console.error);
