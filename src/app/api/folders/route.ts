import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prefix = searchParams.get("prefix") || ""; 
  const fetchAllPaths = searchParams.get("fetchAllPaths") === "true";
  
  const basePrefix = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels\\';

  if (fetchAllPaths) {
    const allProducts = await prisma.product.findMany({ select: { btwFilePath: true } });
    const allFolders = new Set<string>();
    for (const p of allProducts) {
      if (!p.btwFilePath || !p.btwFilePath.startsWith(basePrefix)) continue;
      const rel = p.btwFilePath.substring(basePrefix.length);
      const parts = rel.split('\\');
      parts.pop(); // remove file name
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? currentPath + "\\" + part : part;
        if (currentPath) allFolders.add(currentPath);
      }
    }
    return NextResponse.json({ folders: Array.from(allFolders).sort((a, b) => a.localeCompare(b)) });
  }

  const normalizedPrefix = prefix ? prefix.replace(/\\/g, '\\') + '\\' : '';
  const searchPrefix = basePrefix + normalizedPrefix;

  // Pull the full product (all scalar fields + template) so the client gets
  // every label field — quantity, composition, sku2, boxWeight, sponsorText,
  // manufacturer, etc. The previous explicit `select` listed only a subset
  // and silently dropped the rest, so on a second computer (or after any
  // edit on field outside the select) the inspector pre-filled empty for
  // those columns even though /api/render saw correct values from the DB.
  const allProducts = await prisma.product.findMany({
    where: {
      btwFilePath: {
        startsWith: searchPrefix,
      }
    },
    include: { template: true },
  });
  
  const folders = new Set<string>();
  const files: any[] = [];

  for (let i = 0; i < allProducts.length; i++) {
    const p = allProducts[i];
    if (!p.btwFilePath) continue;
    
    let rel = p.btwFilePath;
    if (rel.startsWith(basePrefix)) rel = rel.substring(basePrefix.length);

    if (normalizedPrefix === '' || rel.toLowerCase().startsWith(normalizedPrefix.toLowerCase())) {
      const rest = rel.substring(normalizedPrefix.length);
      const slashIdx = rest.indexOf('\\');
      
      if (slashIdx === -1) {
        files.push(p); // Add direct file
      } else {
        folders.add(rest.substring(0, slashIdx)); // Add folder
      }
    }
  }

  return NextResponse.json({
    folders: Array.from(folders).sort((a, b) => a.localeCompare(b)),
    files: files.filter(f => f.name !== "_folder_marker").sort((a,b) => (a.name || "").localeCompare(b.name || ""))
  });
}

// PATCH /api/folders — move a folder (and everything under it) to another
// place in the virtual tree. Body: { source: string, target: string }
//   - source: relative path of the folder to move (e.g. "Цех ПЦО\\Конфеты\\Шоу-боксы\\ШБ ТУЛА")
//   - target: relative path of the destination *parent* folder ("МП\\ПЦО"
//             means the moved folder lands as "МП\\ПЦО\\ШБ ТУЛА"). Pass ""
//             to move to the root.
//
// Mechanics: the virtual folder tree is just a derived view over
// Product.btwFilePath. To move a folder we batch-rewrite btwFilePath of
// every product whose path begins with the source prefix, swapping the
// prefix for the new target prefix. The leaf segment of `source` is kept
// (so "ШБ ТУЛА\\ШК\\foo.btw" under source "А\\B\\ШБ ТУЛА" moves to
// target "МП\\ПЦО" as "МП\\ПЦО\\ШБ ТУЛА\\ШК\\foo.btw"). category is
// updated to the new immediate parent.
export async function PATCH(req: NextRequest) {
  let body: { source?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { source, target } = body;
  if (typeof source !== "string" || !source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }
  if (typeof target !== "string") {
    return NextResponse.json({ error: "target is required (use \"\" for root)" }, { status: 400 });
  }

  const basePrefix = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
  const cleanSource = source.replace(/^[\\/]+|[\\/]+$/g, "");
  const cleanTarget = target.replace(/^[\\/]+|[\\/]+$/g, "");
  const sourceLeaf = cleanSource.split(/[\\/]/).pop() || "";

  if (!sourceLeaf) {
    return NextResponse.json({ error: "source must be a folder path" }, { status: 400 });
  }
  // Forbid no-ops and self-moves into a child of source — would create a
  // loop in the prefix rewrite (target prefix would itself contain source).
  if (cleanSource === cleanTarget) {
    return NextResponse.json({ error: "source equals target" }, { status: 400 });
  }
  if (cleanTarget.toLowerCase().startsWith(cleanSource.toLowerCase() + "\\")) {
    return NextResponse.json({ error: "cannot move a folder into its own descendant" }, { status: 400 });
  }
  // Forbid moving a folder onto a path that already contains a same-named
  // child — silently merging would risk filename collisions and
  // surprise the operator.
  const newFolderPath = cleanTarget ? `${cleanTarget}\\${sourceLeaf}` : sourceLeaf;
  if (cleanSource.toLowerCase() === newFolderPath.toLowerCase()) {
    return NextResponse.json({ error: "destination equals source" }, { status: 400 });
  }
  const collisionPrefix = basePrefix + newFolderPath + "\\";
  const collisions = await prisma.product.count({
    where: { btwFilePath: { startsWith: collisionPrefix } },
  });
  if (collisions > 0) {
    return NextResponse.json(
      { error: `Папка «${sourceLeaf}» уже существует в «${cleanTarget || "Корне"}» (${collisions} товар(ов)). Переименуйте или удалите её перед переносом.` },
      { status: 409 },
    );
  }

  const oldPrefix = basePrefix + cleanSource + "\\";
  const newPrefix = basePrefix + newFolderPath + "\\";

  // Read affected products so we can rewrite btwFilePath one by one (SQLite
  // doesn't support REPLACE-in-place via Prisma updateMany).
  const affected = await prisma.product.findMany({
    where: { btwFilePath: { startsWith: oldPrefix } },
    select: { id: true, btwFilePath: true },
  });

  if (affected.length === 0) {
    return NextResponse.json(
      { error: `Папка «${cleanSource}» пуста или не существует` },
      { status: 404 },
    );
  }

  await prisma.$transaction(
    affected.map((p) => {
      const rewritten = newPrefix + (p.btwFilePath || "").slice(oldPrefix.length);
      // Recompute category (immediate-parent folder leaf) so the catalog
      // filter and the inspector "Категория" badge stay in sync.
      const rel = rewritten.slice(basePrefix.length);
      const segs = rel.split(/[\\/]/);
      segs.pop(); // drop filename
      const newCategory = segs.length > 0 ? segs[segs.length - 1] : null;
      return prisma.product.update({
        where: { id: p.id },
        data: { btwFilePath: rewritten, category: newCategory },
      });
    }),
  );

  await logActivity(req, {
    action: "move",
    targetType: "folder",
    targetId: null,
    targetName: cleanSource,
    summary: `Перенёс папку в «${cleanTarget || "Корень"}» (${affected.length} товар(ов))`,
    details: {
      source: cleanSource,
      target: cleanTarget,
      newFolderPath,
      affectedProducts: affected.length,
    },
  });

  return NextResponse.json({
    success: true,
    moved: affected.length,
    newFolderPath,
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const basePrefix = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels\\';
  const normalizedPrefix = path.replace(/\\/g, '\\') + '\\';
  const searchPrefix = basePrefix + normalizedPrefix;

  // Count what we're about to delete so the audit log captures the
  // blast radius of a folder delete (it cascades all products beneath).
  const affected = await prisma.product.count({
    where: { btwFilePath: { startsWith: searchPrefix } },
  });

  await prisma.product.deleteMany({
    where: {
      btwFilePath: {
        startsWith: searchPrefix,
      }
    }
  });

  await logActivity(req, {
    action: "folder-delete",
    targetType: "folder",
    targetId: null,
    targetName: path,
    summary: `Удалил папку (${affected} товар(ов))`,
    details: { folder: path, affectedProducts: affected },
  });
  return NextResponse.json({ success: true });
}
