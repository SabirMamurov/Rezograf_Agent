import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// SQLite's LOWER()/LIKE are ASCII-only — they do NOT lowercase Cyrillic.
// `LOWER('Кедровая')` returns `'Кедровая'` unchanged, so a SQL substring
// filter never matches mixed-case Russian text. Do the search in JS where
// `String.prototype.toLowerCase()` is Unicode-aware. With ~3k products this
// is a few ms; if the catalog grows past tens of thousands, revisit (e.g.
// register a custom collation via the better-sqlite3 driver adapter).
const norm = (s: string | null | undefined): string =>
  (s || "").toLowerCase().replace(/ё/g, "е");

// GET /api/products — list with search, category filters, and pagination
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const category = searchParams.get("category") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const skip = (page - 1) * limit;

  let products: any[];
  let total: number;

  if (q) {
    const where: any = { name: { not: "_folder_marker" } };
    if (category) where.category = { equals: category };

    const all = await prisma.product.findMany({
      where,
      include: { template: true },
    });

    const tokens = norm(q).split(/\s+/).filter(Boolean);
    const fullQ = norm(q);

    const matches = all.filter((p) => {
      const hay = [p.name, p.sku, p.barcodeEan13, p.category, p.btwFilePath]
        .map(norm)
        .join(" \u0001 ");
      return tokens.every((t) => hay.includes(t));
    });

    matches.sort((a, b) => {
      const an = norm(a.name);
      const bn = norm(b.name);
      const score = (n: string, sku: string, bar: string) => {
        if (n === fullQ) return 0;
        if (n.startsWith(fullQ)) return 1;
        if (sku === fullQ || bar === fullQ) return 2;
        if (n.includes(fullQ)) return 3;
        return 4;
      };
      const sa = score(an, norm(a.sku), norm(a.barcodeEan13));
      const sb = score(bn, norm(b.sku), norm(b.barcodeEan13));
      if (sa !== sb) return sa - sb;
      return an.localeCompare(bn, "ru");
    });

    total = matches.length;
    products = matches.slice(skip, skip + limit);
  } else {
    const where: any = { name: { not: "_folder_marker" } };
    if (category) where.category = { equals: category };

    [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { template: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);
  }

  // Optimize: Only fetch distinct categories if the client asks for page 1 
  // and no search query is active, to save SQLite/Prisma from full table scans.
  let categories: string[] = [];
  if (page === 1 && !q) {
    const cats = await prisma.product.findMany({
      select: { category: true },
      distinct: ["category"],
      where: { category: { not: null } },
      orderBy: { category: "asc" },
    });
    categories = cats.map((c) => c.category).filter((c): c is string => c !== null && c.length > 0);
  }

  return NextResponse.json({
    products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    categories,
  });
}

// POST /api/products — create a new product
export async function POST(req: NextRequest) {
  const body = await req.json();
  const product = await prisma.product.create({
    data: {
      name: body.name,
      sku: body.sku || null,
      category: body.category || null,
      subcategory: body.subcategory || null,
      composition: body.composition || null,
      weight: body.weight || null,
      nutritionalInfo: body.nutritionalInfo || null,
      storageCond: body.storageCond || null,
      manufacturer: body.manufacturer || null,
      barcodeEan13: body.barcodeEan13 || null,
      btwFilePath: body.btwFilePath || null,
      certCode: body.certCode || null,
      quantity: body.quantity || null,
      boxWeight: body.boxWeight || null,
      sponsorText: body.sponsorText || null,
      templateId: body.templateId || null,
    },
  });
  return NextResponse.json(product, { status: 201 });
}

// PATCH /api/products — update a product by id (inline edit)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Only allow updating known fields
  const allowedFields = [
    "name",
    "sku",
    "category",
    "subcategory",
    "composition",
    "weight",
    "nutritionalInfo",
    "storageCond",
    "manufacturer",
    "barcodeEan13",
    "btwFilePath",
    "certCode",
    "quantity",
    "boxWeight",
    "sponsorText"
  ];

  const updateData: Record<string, string | null> = {};
  for (const key of allowedFields) {
    if (key in data) {
      updateData[key] = data[key] || null;
    }
  }

  const product = await prisma.product.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(product);
}

// DELETE /api/products — delete a product by id
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
