import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";

export const runtime = "nodejs";

/** 지금 현장의 업체 목록 + 최근 60일 반출 대수(자주 오는 업체 고를 때 참고) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { data, error } = await db().from("companies").select("*")
      .eq("site_id", site.id).eq("active", true).order("sort_order");
    if (error) throw new Error(error.message);

    const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const recent = new Map<string, number>();
    for (let off = 0; off < 50_000; off += 1000) {
      const { data: rows } = await db().from("dispatches").select("company")
        .eq("site_id", site.id).gte("report_date", since).range(off, off + 999);
      (rows ?? []).forEach((r) => recent.set(r.company, (recent.get(r.company) ?? 0) + 1));
      if (!rows || rows.length < 1000) break;
    }
    return NextResponse.json({ companies: (data ?? []).map((c) => ({ ...c, recent: recent.get(c.name) ?? 0 })) });
  });
}

/** 업체 추가 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { name } = (await req.json()) as { name: string };
    const n = name?.trim();
    if (!n) throw new HttpError(400, "업체 이름을 입력하세요.");
    const { data: last } = await db().from("companies").select("sort_order")
      .eq("site_id", site.id).order("sort_order", { ascending: false }).limit(1);
    const { error } = await db().from("companies").upsert(
      { site_id: site.id, name: n, active: true, sort_order: (last?.[0]?.sort_order ?? 0) + 1 },
      { onConflict: "site_id,name" },
    );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}

/** 순서·따로·자주 표시 일괄 저장: [{id, sort_order, separate, frequent}] */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { companies } = (await req.json()) as { companies: { id: number; sort_order: number; separate: boolean; frequent?: boolean }[] };
    for (const c of companies) {
      const { error } = await db().from("companies")
        .update({ sort_order: c.sort_order, separate: c.separate, frequent: !!c.frequent })
        .eq("id", c.id).eq("site_id", site.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  });
}

/** 숨기기 (지난 기록의 업체명은 그대로 남음) */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const id = req.nextUrl.searchParams.get("id");
    const { error } = await db().from("companies").update({ active: false }).eq("id", id).eq("site_id", site.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
