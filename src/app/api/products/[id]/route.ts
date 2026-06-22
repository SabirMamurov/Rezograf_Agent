import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity, diffProduct, summarizeDiff } from "@/lib/activity-log";

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
  const before = await prisma.product.findUnique({ where: { id } });
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
      extraText: body.extraText !== undefined ? body.extraText : undefined,
      manufacturerType: body.manufacturerType !== undefined ? body.manufacturerType : undefined,
      showCedarLogo: body.showCedarLogo !== undefined ? !!body.showCedarLogo : undefined,
      templateId: body.templateId ?? undefined,
    },
  });
  if (before) {
    const diff = diffProduct(
      before as unknown as Record<string, unknown>,
      product as unknown as Record<string, unknown>,
    );
    if (Object.keys(diff).length > 0) {
      await logActivity(req, {
        action: "edit",
        targetType: "product",
        targetId: product.id,
        targetName: product.name,
        summary: summarizeDiff(diff),
        details: diff,
      });
    }
  }
  return NextResponse.json(product);
}

// DELETE /api/products/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const before = await prisma.product.findUnique({ where: { id } });
  await prisma.product.delete({ where: { id } });
  await logActivity(req, {
    action: "delete",
    targetType: "product",
    targetId: id,
    targetName: before?.name ?? null,
    summary: "Удалил товар",
    details: before
      ? { sku: before.sku, category: before.category, btwFilePath: before.btwFilePath }
      : null,
  });
  return NextResponse.json({ ok: true });
}
