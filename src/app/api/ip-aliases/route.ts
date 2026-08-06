import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/auth";

/**
 * IP → человеческое имя. Оператор подписывает свои рабочие места
 * («Иван, ПЦО-1», «Планшет на упаковке»), в модалке истории печати
 * вместо голого IP отображается это имя.
 *
 * GET  /api/ip-aliases            → {aliases: {ip: name}}
 * PUT  /api/ip-aliases            → body {ip, name}, upsert
 * DELETE /api/ip-aliases?ip=…     → удалить
 *
 * Просмотр — без auth (оператор в модалке истории читает их сам).
 * Правка/удаление — только admin.
 */

type P = { ipAlias: {
  findMany: () => Promise<Array<{ip: string; name: string; updatedAt: Date}>>;
  upsert: (a: unknown) => Promise<unknown>;
  delete: (a: unknown) => Promise<unknown>;
} };

export async function GET() {
  const rows = await (prisma as unknown as P).ipAlias.findMany();
  const aliases: Record<string, string> = {};
  for (const r of rows) aliases[r.ip] = r.name;
  return NextResponse.json({ aliases });
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Только для admin" }, { status: 403 });
  }
  const body = await req.json();
  const ip = String(body?.ip || "").trim();
  const name = String(body?.name || "").trim();
  if (!ip) return NextResponse.json({ error: "ip is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  await (prisma as unknown as P).ipAlias.upsert({
    where: { ip },
    create: { ip, name },
    update: { name },
  });
  return NextResponse.json({ success: true, ip, name });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Только для admin" }, { status: 403 });
  }
  const url = new URL(req.url);
  const ip = (url.searchParams.get("ip") || "").trim();
  if (!ip) return NextResponse.json({ error: "ip is required" }, { status: 400 });
  try {
    await (prisma as unknown as P).ipAlias.delete({ where: { ip } });
  } catch {
    /* уже удалён — ок */
  }
  return NextResponse.json({ success: true });
}
