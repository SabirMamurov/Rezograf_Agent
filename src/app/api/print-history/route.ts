import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/print-history?limit=200&q=&product_id=
 *
 * История печати (аудит) — читается из /print под кнопкой «📊 История
 * печати», которая появляется только в edit-режиме. Фильтр `q` ищет
 * подстроку по productName/barcode (Unicode toLowerCase в JS —
 * SQLite ASCII-only LOWER не подходит для кириллицы).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/ё/g, "е");
  const productId = url.searchParams.get("product_id") || undefined;

  const entries = await (prisma as unknown as {printHistory: {findMany: (a: unknown) => Promise<Array<{
    id: string; createdAt: Date; ip: string | null; userAgent: string | null;
    productId: string | null; productName: string | null; barcode: string | null;
    format: string; copies: number; sizeBytes: number | null; renderTimeMs: number | null;
  }>>}}).printHistory.findMany({
    where: productId ? { productId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let filtered = entries;
  if (q) {
    filtered = entries.filter(e => {
      const hay = [e.productName, e.barcode].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
      return hay.includes(q);
    });
  }

  return NextResponse.json({
    entries: filtered.map(e => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      ip: e.ip,
      productId: e.productId,
      productName: e.productName,
      barcode: e.barcode,
      format: e.format,
      copies: e.copies,
      sizeBytes: e.sizeBytes,
      renderTimeMs: e.renderTimeMs,
    })),
    total: filtered.length,
  });
}
