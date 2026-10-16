import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";

export const runtime = "nodejs";

/** 지금 현장의 업체 목록 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { data, error } = await db().from("companies").select("*")
      .eq("site_id", site.id).eq("active", true).order("sort_order");
    if (error) throw new Error(error.message);
    return NextResponse.json({ companies: data });
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

/** 순서·따로 표시 일괄 저장: [{id, sort_order, separate}] */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { companies } = (await req.json()) as { companies: { id: number; sort_order: number; separate: boolean }[] };
    for (const c of companies) {
      const { error } = await db().from("companies")
        .update({ sort_order: c.sort_order, separate: c.separate })
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
