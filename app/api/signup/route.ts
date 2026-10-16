import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { adminEmails, handle, HttpError } from "@/lib/access";
import { SESSION_COOKIE, cookieOptions, createSessionToken } from "@/lib/session";

export const runtime = "nodejs";

/**
 * 가입: 계정은 바로 만들되 '승인 대기' 상태.
 * 관리자가 승인하고 현장을 배정해야 기록을 볼 수 있다.
 * (메일 인증 없이 서버에서 바로 만들기 때문에 메일 발송 설정이 필요 없음)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string; note?: string };
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const note = String(body.note ?? "").trim().slice(0, 200);

    if (!name) throw new HttpError(400, "이름을 입력하세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "이메일 형식이 올바르지 않습니다.");
    if (password.length < 8) throw new HttpError(400, "비밀번호는 8자 이상으로 정하세요.");

    const { data, error } = await db().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) {
      const dup = error?.code === "email_exists" || /already|registered|exists/i.test(error?.message ?? "");
      throw new HttpError(dup ? 409 : 400, dup ? "이미 가입된 이메일입니다. 로그인하세요." : error?.message ?? "가입 실패");
    }

    const isAdmin = adminEmails().includes(email);
    const { error: pErr } = await db().from("profiles").insert({
      user_id: data.user.id,
      email,
      name,
      note,
      role: isAdmin ? "admin" : "member",
      status: isAdmin ? "active" : "pending",
      approved_at: isAdmin ? new Date().toISOString() : null,
    });
    if (pErr) {
      await db().auth.admin.deleteUser(data.user.id);
      throw new Error(pErr.message);
    }

    const res = NextResponse.json({ ok: true, status: isAdmin ? "active" : "pending" });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(data.user.id), cookieOptions);
    return res;
  });
}
