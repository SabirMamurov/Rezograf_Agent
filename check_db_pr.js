const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const products = await prisma.product.findMany({ take: 5 });
    console.log(products.map(p => ({
        id: p.id,
        name: p.name,
        btwFilePath: p.btwFilePath
    })));
    await prisma.$disconnect();
}

check();
