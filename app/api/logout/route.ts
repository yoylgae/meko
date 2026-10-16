import { NextResponse } from "next/server";
import { SESSION_COOKIE, SITE_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(SITE_COOKIE);
  return res;
}
