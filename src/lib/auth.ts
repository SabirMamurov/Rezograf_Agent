import { NextRequest } from "next/server";

// Cookie that marks a browser as "edit mode unlocked". It holds ADMIN_TOKEN
// (a server-side secret), is httpOnly so client JS can't read or forge it, and
// lives long (90 days) so the operator types the password once per machine.
export const ADMIN_COOKIE = "rezograf_admin";
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

// True when the request carries a valid admin cookie. The gate is enforced
// HERE (server side) on every mutating route — hiding buttons in the UI is
// only cosmetic; anyone on the LAN could otherwise POST directly to the API.
export function isAdminRequest(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  return req.cookies.get(ADMIN_COOKIE)?.value === token;
}
