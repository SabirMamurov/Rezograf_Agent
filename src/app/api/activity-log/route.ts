import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/activity-log — read recent audit-log entries.
//
// Query params:
//   limit (default 200, max 1000)  — how many rows to return.
//   action  — optional filter: "edit" | "create" | "delete" | …
//   ip      — optional filter: exact IP match.
//   q       — optional substring match on targetName.
//
// Response: { entries: ActivityLogEntry[] }
//   Each entry has parsed `details` instead of raw JSON string.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawLimit = parseInt(searchParams.get("limit") || "200", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 1000);
  const action = searchParams.get("action");
  const ip = searchParams.get("ip");
  const q = (searchParams.get("q") || "").trim();

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (ip) where.ip = ip;
  if (q) where.targetName = { contains: q };

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const entries = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    ip: r.ip,
    userAgent: r.userAgent,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    targetName: r.targetName,
    summary: r.summary,
    details: r.details ? safeParse(r.details) : null,
  }));

  return NextResponse.json({ entries });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
