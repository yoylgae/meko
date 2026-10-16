import { NextRequest, NextResponse } from "next/server";
import { checkPassword, db } from "@/lib/supabase";
import { adminEmails, handle, HttpError } from "@/lib/access";
import { SESSION_COOKIE, SITE_COOKIE, cookieOptions, createSessionToken } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) throw new HttpError(400, "이메일과 비밀번호를 입력하세요.");

    const uid = await checkPassword(email, password);
    if (!uid) throw new HttpError(401, "이메일 또는 비밀번호가 틀렸습니다.");

    let { data: profile } = await db().from("profiles").select("*").eq("user_id", uid).maybeSingle();
    const isAdmin = adminEmails().includes(email);
    if (!profile) {
      // Supabase 화면에서 직접 만든 계정 등: 대기 상태로 등록
      const { data } = await db().from("profiles").insert({
        user_id: uid, email, name: email.split("@")[0],
        role: isAdmin ? "admin" : "member", status: isAdmin ? "active" : "pending",
        approved_at: isAdmin ? new Date().toISOString() : null,
      }).select("*").single();
      profile = data;
    } else if (isAdmin && (profile.role !== "admin" || profile.status !== "active")) {
      // ADMIN_EMAILS에 있는 이메일은 항상 관리자
      const { data } = await db().from("profiles")
        .update({ role: "admin", status: "active", approved_at: profile.approved_at ?? new Date().toISOString() })
        .eq("user_id", uid).select("*").single();
      profile = data;
    }
    if (profile?.status === "disabled") throw new HttpError(403, "사용이 정지된 계정입니다. 관리자에게 문의하세요.");

    const res = NextResponse.json({ ok: true, status: profile?.status, role: profile?.role });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(uid), cookieOptions);
    res.cookies.delete(SITE_COOKIE);
    return res;
  });
}
