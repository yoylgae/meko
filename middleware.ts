import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  // 비밀번호를 설정하지 않았으면 잠금 없이 동작
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  const ok = req.cookies.get(AUTH_COOKIE)?.value === (await authToken());
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
