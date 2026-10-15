import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const { data, error } = await db().from("companies").select("*").eq("active", true).order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ companies: data });
}

/** 업체 추가 */
export async function POST(req: NextRequest) {
  const { name } = (await req.json()) as { name: string };
  const n = name?.trim();
  if (!n) return NextResponse.json({ error: "업체 이름을 입력하세요." }, { status: 400 });
  const { data: last } = await db().from("companies").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await db()
    .from("companies")
    .upsert({ name: n, active: true, sort_order: (last?.[0]?.sort_order ?? 0) + 1 }, { onConflict: "name" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** 순서·따로 표시 일괄 저장: [{id, sort_order, separate}] */
export async function PATCH(req: NextRequest) {
  const { companies } = (await req.json()) as { companies: { id: number; sort_order: number; separate: boolean }[] };
  for (const c of companies) {
    const { error } = await db().from("companies").update({ sort_order: c.sort_order, separate: c.separate }).eq("id", c.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** 숨기기 (지난 기록의 업체명은 그대로 남음) */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const { error } = await db().from("companies").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
