import { NextRequest, NextResponse } from "next/server";
import { checkPassword, db } from "@/lib/supabase";
import { handle, HttpError, sessionProfile } from "@/lib/access";

export const runtime = "nodejs";

/** 내 비밀번호 바꾸기 (관리자가 초기화해 준 임시 비밀번호를 바꿀 때도 사용) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const p = await sessionProfile(req);
    const { current, next } = (await req.json()) as { current: string; next: string };
    if (String(next ?? "").length < 8) throw new HttpError(400, "새 비밀번호는 8자 이상으로 정하세요.");
    const ok = await checkPassword(p.email, String(current ?? ""));
    if (ok !== p.user_id) throw new HttpError(400, "지금 비밀번호가 틀렸습니다.");
    const { error } = await db().auth.admin.updateUserById(p.user_id, { password: next });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
