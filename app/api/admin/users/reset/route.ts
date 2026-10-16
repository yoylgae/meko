import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { handle, HttpError, requireAdmin } from "@/lib/access";

export const runtime = "nodejs";

/** 비밀번호를 잊었을 때: 임시 비밀번호를 만들어 한 번만 보여 줌 (메일 발송 없이) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const { userId } = (await req.json()) as { userId: string };
    if (!userId) throw new HttpError(400, "userId 필요");
    // 헷갈리는 글자(0/O, 1/l/I) 뺀 10자리
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const rnd = crypto.getRandomValues(new Uint32Array(10));
    const temp = Array.from(rnd, (n) => chars[n % chars.length]).join("");
    const { error } = await db().auth.admin.updateUserById(userId, { password: temp });
    if (error) throw new Error(error.message);
    return NextResponse.json({ password: temp });
  });
}
