import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, cleanPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const expected = cleanPassword(process.env.APP_PASSWORD);
  if (!expected) {
    return NextResponse.json({ error: "서버에 APP_PASSWORD가 설정되지 않았습니다." }, { status: 500 });
  }
  if (cleanPassword(password) !== expected) {
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
