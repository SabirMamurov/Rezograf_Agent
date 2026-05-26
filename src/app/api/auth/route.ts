import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_MAX_AGE, isAdminRequest } from "@/lib/auth";

// GET /api/auth — is this browser in edit mode? Used by the UI to show/hide
// editing controls.
export async function GET(req: NextRequest) {
  return NextResponse.json({ isAdmin: isAdminRequest(req) });
}

// POST /api/auth
//   { password } → unlock: set the long-lived admin cookie if the password
//                  matches ADMIN_PASSWORD.
//   { action: "lock" } → clear the cookie (leave edit mode).
export async function POST(req: NextRequest) {
  let body: { password?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.action === "lock") {
    const res = NextResponse.json({ isAdmin: false });
    res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const expected = process.env.ADMIN_PASSWORD;
  const token = process.env.ADMIN_TOKEN;
  if (!expected || !token) {
    return NextResponse.json(
      { error: "Серверный пароль не настроен (ADMIN_PASSWORD/ADMIN_TOKEN в .env)" },
      { status: 500 },
    );
  }
  if (typeof body.password !== "string" || body.password !== expected) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const res = NextResponse.json({ isAdmin: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_MAX_AGE,
  });
  return res;
}
