import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  // Extremely fast lookup for exactly what we need
  const allProducts = await prisma.product.findMany({
    where: {
      btwFilePath: {
        startsWith: searchPrefix,
      }
    },
    select: {
      id: true,
      name: true,
      sku: true,
      barcodeEan13: true,
      btwFilePath: true,
      category: true,
      weight: true,
      storageCond: true,
      nutritionalInfo: true,
      certCode: true,
      template: true
    }
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

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const basePrefix = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels\\';
  const normalizedPrefix = path.replace(/\\/g, '\\') + '\\';
  const searchPrefix = basePrefix + normalizedPrefix;

  await prisma.product.deleteMany({
    where: {
      btwFilePath: {
        startsWith: searchPrefix,
      }
    }
  });

  return NextResponse.json({ success: true });
}
