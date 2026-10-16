import { NextRequest, NextResponse } from "next/server";
import { accessibleSites, handle, HttpError, sessionProfile } from "@/lib/access";
import { SITE_COOKIE, cookieOptions } from "@/lib/session";

export const runtime = "nodejs";

/** 내 계정 상태 + 열 수 있는 현장(관리자는 전체) + 지금 고른 현장 (승인 대기여도 응답) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const p = await sessionProfile(req);
    const sites = p.status === "active" ? await accessibleSites(p) : [];
    const want = Number(req.cookies.get(SITE_COOKIE)?.value);
    const current = sites.find((s) => s.id === want) ?? sites[0] ?? null;
    return NextResponse.json({
      user: { email: p.email, name: p.name, role: p.role, status: p.status },
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
      siteId: current?.id ?? null,
    });
  });
}

/** 작업할 현장 바꾸기 — 열 수 있는 현장만 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const p = await sessionProfile(req);
    if (p.status !== "active") throw new HttpError(403, "관리자 승인을 기다리는 중입니다.");
    const { siteId } = (await req.json()) as { siteId: number };
    const sites = await accessibleSites(p);
    if (!sites.some((s) => s.id === Number(siteId))) throw new HttpError(403, "볼 수 없는 현장입니다.");
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SITE_COOKIE, String(siteId), { ...cookieOptions, httpOnly: false });
    return res;
  });
}
