import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

// POST /api/products/[id]/rename
//
// Узкая операция, доступная БЕЗ административной авторизации: меняется
// только последний сегмент btwFilePath ("имя файла"). Не трогает состав,
// штрихкод, производителя, путь до родительской папки и любые другие
// поля — всё остальное остаётся как было.
//
// Зачем без пароля: операторам на складе и в цехе часто требуется поправить
// опечатку в имени конкретной этикетки, и эта операция безопасна — она
// меняет только то, как файл показывается в дереве папок. Полный
// редактор-форма остаётся под паролем "zasada".
//
// Защиты:
// - принимаем ровно одно поле fileName (string), всё остальное игнорируем;
// - очищаем слэши (\\ /) — иначе пользователь мог бы случайно создать
//   подпапку и "потерять" этикетку (тот же приём в saveEdit/handleCreateLabel);
// - не позволяем пустое имя — иначе btwFilePath укоротится до префикса и
//   товар "съедет" в родительскую папку.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const rawFileName = typeof body.fileName === "string" ? body.fileName : "";
  const safeFileName = rawFileName
    .trim()
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!safeFileName) {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }
  const before = await prisma.product.findUnique({ where: { id } });
  if (!before) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (!before.btwFilePath) {
    // Без btwFilePath переименование лишено смысла — у товара нет файла
    // в дереве. Отказываем, чтобы не плодить непредвиденных побочек.
    return NextResponse.json({ error: "Product has no file path" }, { status: 409 });
  }
  const parts = before.btwFilePath.split(/[\\/]/);
  const oldName = parts[parts.length - 1] || "";
  parts[parts.length - 1] = safeFileName;
  const newBtwFilePath = parts.join("\\");

  if (newBtwFilePath === before.btwFilePath) {
    return NextResponse.json(before);
  }

  const product = await prisma.product.update({
    where: { id },
    data: { btwFilePath: newBtwFilePath },
  });

  await logActivity(req, {
    action: "edit",
    targetType: "product",
    targetId: product.id,
    targetName: product.name,
    summary: `Переименовал файл: «${oldName}» → «${safeFileName}»`,
    details: { before: oldName, after: safeFileName },
  });

  return NextResponse.json(product);
}
