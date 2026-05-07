import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Append-only audit logging. The app has no auth, so we identify the
// "who" by the client's LAN IP. See prisma/schema.prisma > ActivityLog
// and the hidden /changelog?activity=1 reader UI.

export interface LogEntryInput {
  action: "create" | "edit" | "delete" | "duplicate" | "move" | "folder-delete" | "folder-create";
  targetType: "product" | "folder";
  targetId?: string | null;
  targetName?: string | null;
  summary?: string | null;
  details?: unknown;
}

/**
 * Extract the client IP from a Next request. Behind a reverse proxy or
 * macOS dev server we get it via X-Forwarded-For; on the bare prod VM
 * (no proxy) we fall back to the connection's remoteAddress, which Next
 * exposes through req.ip in newer versions but not always — peek at the
 * NEXT_RUNTIME-specific paths.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // X-Forwarded-For: client, proxy1, proxy2 — take the leftmost.
    return forwarded.split(",")[0].trim();
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  // Next.js 16 NextRequest doesn't expose .ip directly anymore; the LAN
  // VM has no upstream proxy so the X-Forwarded-For path won't fire there.
  // We accept "unknown" as the worst case — better than crashing the
  // mutation just because we couldn't get the IP.
  return "unknown";
}

/**
 * Best-effort fire-and-forget activity log. Failures here MUST NOT
 * propagate — a missing log entry is far less bad than a failed product
 * edit, so we swallow errors and log to the server console.
 */
export async function logActivity(req: NextRequest, entry: LogEntryInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        ip: getClientIp(req),
        userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetName: entry.targetName ?? null,
        summary: entry.summary ?? null,
        details: entry.details === undefined ? null : JSON.stringify(entry.details),
      },
    });
  } catch (err) {
    console.error("[activity-log] failed to write entry", err);
  }
}

/**
 * Diff two product-shaped records and produce a `{ field: { before, after } }`
 * map limited to fields that actually changed. Useful as the `details`
 * payload for an "edit" log entry. Skips id/createdAt/updatedAt/template
 * (the join — would always look "changed" because of the include).
 */
export function diffProduct(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const skip = new Set(["id", "createdAt", "updatedAt", "template"]);
  const out: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (b !== a) {
      out[k] = { before: b, after: a };
    }
  }
  return out;
}

/**
 * Compose a short Russian summary from a diff map for the operator log.
 * Returns "Изменил: <field1>, <field2>" or null if no fields.
 */
export function summarizeDiff(diff: Record<string, unknown>): string | null {
  const labels: Record<string, string> = {
    name: "название",
    sku: "артикул",
    sku2: "артикул 2",
    composition: "состав",
    weight: "массу",
    nutritionalInfo: "КБЖУ",
    storageCond: "срок хранения",
    barcodeEan13: "штрихкод",
    btwFilePath: "имя файла",
    certCode: "стандарт",
    quantity: "количество",
    boxWeight: "массу коробки",
    sponsorText: "спонсор",
    manufacturer: "изготовителя",
    category: "папку",
    templateId: "шаблон",
  };
  const fields = Object.keys(diff)
    .map((k) => labels[k] || k)
    .filter(Boolean);
  if (fields.length === 0) return null;
  return `Изменил: ${fields.join(", ")}`;
}
