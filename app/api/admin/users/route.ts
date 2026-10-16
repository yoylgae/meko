import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { handle, HttpError, requireAdmin, type Profile } from "@/lib/access";

export const runtime = "nodejs";

/** 전체 계정 + 각자 배정된 현장 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const [{ data: users, error }, { data: members }] = await Promise.all([
      db().from("profiles").select("*").order("created_at", { ascending: false }),
      db().from("site_members").select("site_id, user_id"),
    ]);
    if (error) throw new Error(error.message);
    const order = { pending: 0, active: 1, disabled: 2 } as const;
    const list = ((users ?? []) as Profile[])
      .map((u) => ({ ...u, siteIds: (members ?? []).filter((m) => m.user_id === u.user_id).map((m) => m.site_id as number) }))
      .sort((a, b) => order[a.status] - order[b.status]);
    return NextResponse.json({ users: list });
  });
}

/** 승인·정지·관리자 지정·현장 배정 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const body = (await req.json()) as {
      userId: string;
      status?: Profile["status"];
      role?: Profile["role"];
      siteIds?: number[];
      name?: string;
    };
    if (!body.userId) throw new HttpError(400, "userId 필요");
    if (body.userId === me.user_id && (body.status && body.status !== "active" || body.role && body.role !== "admin")) {
      throw new HttpError(400, "자기 자신의 관리자 권한을 해제하거나 정지할 수는 없습니다.");
    }

    const patch: Record<string, unknown> = {};
    if (body.status) {
      if (!["pending", "active", "disabled"].includes(body.status)) throw new HttpError(400, "잘못된 상태");
      patch.status = body.status;
      if (body.status === "active") patch.approved_at = new Date().toISOString();
    }
    if (body.role) {
      if (!["admin", "member"].includes(body.role)) throw new HttpError(400, "잘못된 권한");
      patch.role = body.role;
    }
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (Object.keys(patch).length) {
      const { error } = await db().from("profiles").update(patch).eq("user_id", body.userId);
      if (error) throw new Error(error.message);
    }

    if (Array.isArray(body.siteIds)) {
      const ids = [...new Set(body.siteIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      const { error: dErr } = await db().from("site_members").delete().eq("user_id", body.userId);
      if (dErr) throw new Error(dErr.message);
      if (ids.length) {
        const { error: iErr } = await db().from("site_members").insert(ids.map((site_id) => ({ site_id, user_id: body.userId })));
        if (iErr) throw new Error(iErr.message);
      }
    }
    return NextResponse.json({ ok: true });
  });
}

/** 가입 거절·계정 삭제 (그 사람이 입력한 현장 기록은 현장에 그대로 남음) */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin(req);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new HttpError(400, "id 필요");
    if (id === me.user_id) throw new HttpError(400, "자기 자신은 삭제할 수 없습니다.");
    const { error } = await db().auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
