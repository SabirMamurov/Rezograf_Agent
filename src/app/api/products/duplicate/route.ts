import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

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

  // Preserve the source product's filename EXACTLY (last segment of
  // btwFilePath). Operators intentionally keep two distinct fields:
  //   - `name` — what's printed on the label
  //   - filename in `btwFilePath` — what they see in the file list
  // These differ on purpose (e.g. name «Кедровый грильяж в шоколаде» vs
  // filename «Кедровый грильяж, шоколад 4 шт.btw»). The previous version
  // overwrote the filename with a sanitized `name` on every duplicate,
  // forcing operators to retype the proper file name afterwards.
  //
  // Sanitization is still applied (strip `\`/`/` so a dirty source path
  // can't propagate phantom subfolders into the new copy — see the
  // companion guard in saveEdit on the client). If the source has no
  // btwFilePath at all, fall back to «<name>.btw».
  let fileName: string;
  if (source.btwFilePath) {
    const parts = source.btwFilePath.split(/[\\/]/);
    const last = parts[parts.length - 1] || "";
    fileName = last.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  } else {
    fileName = "";
  }
  if (!fileName) {
    const baseName = (source.name || "label")
      .replace(/[\\/:*?"<>|\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "label";
    fileName = `${baseName}.btw`;
  }

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
      extraText: source.extraText,
      templateId: source.templateId,
    },
  });

  await logActivity(req, {
    action: "duplicate",
    targetType: "product",
    targetId: copy.id,
    targetName: copy.name,
    summary: `Дублировал в папку «${cleanFolder || "Корень"}»`,
    details: {
      sourceId: source.id,
      sourceName: source.name,
      targetFolder: cleanFolder,
      newBtwFilePath,
    },
  });
  return NextResponse.json(copy, { status: 201 });
}
