import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Same Windows base prefix the rest of the app uses to address btw files.
// Kept in sync with src/app/api/folders/route.ts and src/app/print/page.tsx.
const BASE_PREFIX = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";

// POST /api/products/duplicate — copy a product into another (virtual) folder.
//
// Body: { id: string, targetFolder: string }
//   - id: source product id
//   - targetFolder: relative folder path under BASE_PREFIX (e.g. "Молочка\\Сыры").
//                   Use "" to drop the copy at the root.
//
// Behavior: clones every field of the source product except id/createdAt/updatedAt,
// then rewrites btwFilePath so the copy lives in `targetFolder`. The filename
// (last `\\`-segment of the source btwFilePath) is preserved verbatim, so the
// extension and casing match the original. category is set to targetFolder, the
// same convention used by create / move flows.
export async function POST(req: NextRequest) {
  let body: { id?: string; targetFolder?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { id, targetFolder } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof targetFolder !== "string") {
    return NextResponse.json(
      { error: "targetFolder is required (string, '' for root)" },
      { status: 400 },
    );
  }

  const source = await prisma.product.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "source product not found" }, { status: 404 });
  }

  // Derive the duplicate's filename from the SOURCE PRODUCT NAME, not from
  // the source's existing btwFilePath. Many products have a legacy mismatch
  // between `name` and the filename portion of `btwFilePath` (renamed in
  // the catalog without re-naming the .btw, or imported from BarTender with
  // a generic file name). Copying the old filename verbatim — as the prior
  // version did — meant the duplicate inherited a name that no longer
  // matched the product, and operators had to manually fix it every time.
  // Sanitise the name for use as a Windows-style filename: strip path
  // separators and any embedded ".btw"/newlines/leading-trailing whitespace
  // so the result is a clean "<name>.btw" segment.
  const baseName = (source.name || "label")
    .replace(/\.btw[\s\S]*$/i, "")        // drop ".btw" + anything after
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")   // strip illegal filename chars
    .replace(/\s+/g, " ")                  // collapse whitespace
    .trim() || "label";
  const fileName = `${baseName}.btw`;

  const cleanFolder = targetFolder.replace(/^[\\/]+|[\\/]+$/g, "");
  const newBtwFilePath = cleanFolder
    ? `${BASE_PREFIX}${cleanFolder}\\${fileName}`
    : `${BASE_PREFIX}${fileName}`;

  // Copy every product field except identity / timestamps. Listing them
  // explicitly (rather than spreading source) so adding a new column to the
  // schema forces a conscious decision here.
  const copy = await prisma.product.create({
    data: {
      name: source.name,
      sku: source.sku,
      sku2: source.sku2,
      category: cleanFolder || null,
      subcategory: source.subcategory,
      composition: source.composition,
      weight: source.weight,
      nutritionalInfo: source.nutritionalInfo,
      storageCond: source.storageCond,
      manufacturer: source.manufacturer,
      barcodeEan13: source.barcodeEan13,
      btwFilePath: newBtwFilePath,
      certCode: source.certCode,
      quantity: source.quantity,
      boxWeight: source.boxWeight,
      sponsorText: source.sponsorText,
      templateId: source.templateId,
    },
  });

  return NextResponse.json(copy, { status: 201 });
}
