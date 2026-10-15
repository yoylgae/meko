import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 틀렸습니다." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
