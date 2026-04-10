import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/products/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  return NextResponse.json(product);
}

// PUT /api/products/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const product = await prisma.product.update({
    where: { id },
    data: {
      name: body.name,
      sku: body.sku ?? undefined,
      composition: body.composition ?? undefined,
      weight: body.weight ?? undefined,
      nutritionalInfo: body.nutritionalInfo ?? undefined,
      storageCond: body.storageCond ?? undefined,
      barcodeEan13: body.barcodeEan13 ?? undefined,
      certCode: body.certCode !== undefined ? body.certCode : undefined,
      quantity: body.quantity !== undefined ? body.quantity : undefined,
      boxWeight: body.boxWeight !== undefined ? body.boxWeight : undefined,
      sponsorText: body.sponsorText !== undefined ? body.sponsorText : undefined,
      templateId: body.templateId ?? undefined,
    },
  });
  return NextResponse.json(product);
}

// DELETE /api/products/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
