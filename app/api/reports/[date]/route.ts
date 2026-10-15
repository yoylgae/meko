import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import type { Dispatch } from "@/lib/form";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ date: string }> };
const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** 하루치 기록 + 원본 사진 임시 링크. 없으면 빈 기록 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { date } = await params;
  if (!valid(date)) return NextResponse.json({ error: "날짜 형식 오류" }, { status: 400 });

  const { data: report } = await db().from("daily_reports").select("*").eq("report_date", date).maybeSingle();
  if (!report) return NextResponse.json({ exists: false, rows: [], images: [], image_paths: [] });

  const { data: rows } = await db()
    .from("dispatches")
    .select("seq, vehicle_no, company, out_time")
    .eq("report_date", date)
    .order("seq");

  let images: string[] = [];
  if (report.image_paths?.length) {
    const { data } = await db().storage.from("scans").createSignedUrls(report.image_paths, 3600);
    images = (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
  }
  return NextResponse.json({
    exists: true,
    written_total: report.written_total,
    memo: report.memo,
    image_paths: report.image_paths,
    images,
    rows: rows ?? [],
  });
}

/** 하루치 저장 (그날 행 전체를 이 내용으로 교체) */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { date } = await params;
  if (!valid(date)) return NextResponse.json({ error: "날짜 형식 오류" }, { status: 400 });
  const body = (await req.json()) as {
    rows: Dispatch[];
    written_total?: number | null;
    image_paths?: string[];
    memo?: string;
  };

  const rows = (body.rows ?? [])
    .filter((r) => String(r.vehicle_no ?? "").trim() || String(r.company ?? "").trim())
    .map((r, i) => ({
      report_date: date,
      seq: i + 1, // 저장할 때 연번을 1부터 다시 매김
      vehicle_no: String(r.vehicle_no ?? "").trim(),
      company: String(r.company ?? "").trim(),
      out_time: String(r.out_time ?? "").trim(),
    }));

  const { error: e1 } = await db().from("daily_reports").upsert({
    report_date: date,
    written_total: body.written_total ?? null,
    image_paths: body.image_paths ?? [],
    memo: body.memo ?? "",
    updated_at: new Date().toISOString(),
  });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const { error: e2 } = await db().from("dispatches").delete().eq("report_date", date);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  if (rows.length) {
    const { error: e3 } = await db().from("dispatches").insert(rows);
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { date } = await params;
  const { data: report } = await db().from("daily_reports").select("image_paths").eq("report_date", date).maybeSingle();
  if (report?.image_paths?.length) await db().storage.from("scans").remove(report.image_paths);
  const { error } = await db().from("daily_reports").delete().eq("report_date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
