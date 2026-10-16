import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { handle, HttpError, requireAdmin } from "@/lib/access";
import { DEFAULT_COMPANIES } from "@/lib/defaults";

export const runtime = "nodejs";

/** 현장 목록 + 배정된 인원 수 (관리자는 기록 내용은 보지 않음) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const { data, error } = await db()
      .from("sites")
      .select("id, name, active, created_at, site_members(count)")
      .order("active", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return NextResponse.json({
      sites: (data ?? []).map((s) => ({
        id: s.id, name: s.name, active: s.active, created_at: s.created_at,
        members: (s.site_members as { count: number }[])?.[0]?.count ?? 0,
      })),
    });
  });
}

/** 현장 만들기 — 기본 업체 목록을 넣어서 시작 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const { name } = (await req.json()) as { name: string };
    const n = String(name ?? "").trim();
    if (!n) throw new HttpError(400, "현장 이름을 입력하세요.");
    const { data: dup } = await db().from("sites").select("id").eq("name", n).maybeSingle();
    if (dup) throw new HttpError(409, "같은 이름의 현장이 이미 있습니다.");

    const { data: site, error } = await db().from("sites").insert({ name: n }).select("id").single();
    if (error) throw new Error(error.message);
    const { error: cErr } = await db().from("companies").insert(
      DEFAULT_COMPANIES.map((c, i) => ({ site_id: site.id, name: c.name, sort_order: i, separate: !!c.separate }))
    );
    if (cErr) throw new Error(cErr.message);
    return NextResponse.json({ ok: true, id: site.id });
  });
}

/** 이름 바꾸기 / 운영 종료(숨김)·재개 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const { id, name, active } = (await req.json()) as { id: number; name?: string; active?: boolean };
    const patch: Record<string, unknown> = {};
    if (typeof name === "string") {
      if (!name.trim()) throw new HttpError(400, "현장 이름을 입력하세요.");
      patch.name = name.trim();
    }
    if (typeof active === "boolean") patch.active = active;
    const { error } = await db().from("sites").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
