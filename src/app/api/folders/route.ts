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

// PATCH /api/folders — move or rename a folder (and everything under it).
// Body: { source: string, target?: string, newName?: string }
//   - source: relative path of the folder to act on
//             (e.g. "Цех ПЦО\\Конфеты\\Шоу-боксы\\ШБ ТУЛА").
//   - target: relative path of the destination *parent* folder. Used in
//             MOVE mode. Pass "" to move to the root. Required when
//             `newName` is not provided.
//   - newName: NEW leaf name for the folder (RENAME mode). When set, the
//             folder stays under its original parent and only its last
//             segment changes. `target` is ignored in this mode.
//
// Mechanics: the virtual folder tree is just a derived view over
// Product.btwFilePath. Both move and rename are batch-rewrites of every
// product whose path begins with the source prefix; only the new prefix
// differs. The same collision / loop checks apply either way.
export async function PATCH(req: NextRequest) {
  let body: { source?: string; target?: string; newName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { source, target, newName } = body;
  if (typeof source !== "string" || !source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }

  const basePrefix = "C:\\Users\\Пользователь\\Desktop\\extracted_labels\\";
  const cleanSource = source.replace(/^[\\/]+|[\\/]+$/g, "");
  const sourceLeaf = cleanSource.split(/[\\/]/).pop() || "";

  if (!sourceLeaf) {
    return NextResponse.json({ error: "source must be a folder path" }, { status: 400 });
  }

  // ── Compute newFolderPath depending on mode ──────────────────────────
  // RENAME mode: only the leaf segment changes; the parent stays the same.
  // MOVE mode: the parent becomes `target`, the leaf stays the same.
  let cleanTarget: string;
  let newLeaf: string;
  let isRename = false;
  if (typeof newName === "string" && newName.trim()) {
    isRename = true;
    // Strip path separators from the new name — operators have accidentally
    // typed `\` here in the past, which creates phantom subfolders.
    newLeaf = newName.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (!newLeaf) {
      return NextResponse.json({ error: "newName cannot be empty after cleanup" }, { status: 400 });
    }
    // Parent of source = everything but the last segment.
    const sourceParts = cleanSource.split(/[\\/]/);
    sourceParts.pop();
    cleanTarget = sourceParts.join("\\");
  } else {
    if (typeof target !== "string") {
      return NextResponse.json(
        { error: "target is required for move (use \"\" for root), or pass newName for rename" },
        { status: 400 },
      );
    }
    cleanTarget = target.replace(/^[\\/]+|[\\/]+$/g, "");
    newLeaf = sourceLeaf;
  }

  // Move-only guards: forbid no-ops and self-moves into a child of source.
  // For rename: parent is identical by construction, so cleanSource ===
  // cleanTarget would be true if source has no parent; in that case
  // sourceLeaf === newLeaf is the only no-op to guard.
  if (!isRename) {
    if (cleanSource === cleanTarget) {
      return NextResponse.json({ error: "source equals target" }, { status: 400 });
    }
    if (cleanTarget.toLowerCase().startsWith(cleanSource.toLowerCase() + "\\")) {
      return NextResponse.json({ error: "cannot move a folder into its own descendant" }, { status: 400 });
    }
  } else if (sourceLeaf.toLowerCase() === newLeaf.toLowerCase()) {
    return NextResponse.json({ error: "новое имя совпадает с текущим" }, { status: 400 });
  }

  const newFolderPath = cleanTarget ? `${cleanTarget}\\${newLeaf}` : newLeaf;
  if (cleanSource.toLowerCase() === newFolderPath.toLowerCase()) {
    return NextResponse.json({ error: "destination equals source" }, { status: 400 });
  }
  const collisionPrefix = basePrefix + newFolderPath + "\\";
  const collisions = await prisma.product.count({
    where: { btwFilePath: { startsWith: collisionPrefix } },
  });
  if (collisions > 0) {
    const where = isRename ? "в этой же папке" : `в «${cleanTarget || "Корне"}»`;
    return NextResponse.json(
      { error: `Папка «${newLeaf}» уже существует ${where} (${collisions} товар(ов)). Выберите другое имя.` },
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
    summary: isRename
      ? `Переименовал папку «${sourceLeaf}» → «${newLeaf}» (${affected.length} товар(ов))`
      : `Перенёс папку в «${cleanTarget || "Корень"}» (${affected.length} товар(ов))`,
    details: {
      mode: isRename ? "rename" : "move",
      source: cleanSource,
      target: cleanTarget,
      newName: isRename ? newLeaf : undefined,
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
