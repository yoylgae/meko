import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";
import type { Dispatch } from "@/lib/form";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ date: string }> };
const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** 지금 현장의 하루치 기록 + 원본 사진 임시 링크. 없으면 빈 기록 */
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { date } = await params;
    if (!valid(date)) throw new HttpError(400, "날짜 형식 오류");

    const { data: report } = await db().from("daily_reports").select("*")
      .eq("site_id", site.id).eq("report_date", date).maybeSingle();
    if (!report) return NextResponse.json({ exists: false, rows: [], images: [], image_paths: [] });

    const { data: rows } = await db()
      .from("dispatches")
      .select("seq, vehicle_no, company, out_time")
      .eq("site_id", site.id)
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
  });
}

/** 하루치 저장 (그날 행 전체를 이 내용으로 교체) */
export async function PUT(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { date } = await params;
    if (!valid(date)) throw new HttpError(400, "날짜 형식 오류");
    const body = (await req.json()) as {
      rows: Dispatch[];
      written_total?: number | null;
      image_paths?: string[];
      memo?: string;
    };

    // 사진 경로는 이 현장 폴더 것이나 이미 이 기록에 붙어 있던 것만 받음 (다른 현장 사진 연결 방지)
    const { data: prev } = await db().from("daily_reports").select("image_paths")
      .eq("site_id", site.id).eq("report_date", date).maybeSingle();
    const prevPaths: string[] = prev?.image_paths ?? [];
    const imagePaths = (body.image_paths ?? []).filter(
      (p) => typeof p === "string" && (p.startsWith(`site-${site.id}/`) || prevPaths.includes(p)),
    );

    const rows = (body.rows ?? [])
      .filter((r) => String(r.vehicle_no ?? "").trim() || String(r.company ?? "").trim())
      .map((r, i) => ({
        site_id: site.id,
        report_date: date,
        seq: i + 1, // 저장할 때 연번을 1부터 다시 매김
        vehicle_no: String(r.vehicle_no ?? "").trim(),
        company: String(r.company ?? "").trim(),
        out_time: String(r.out_time ?? "").trim(),
      }));

    const { error: e1 } = await db().from("daily_reports").upsert({
      site_id: site.id,
      report_date: date,
      written_total: body.written_total ?? null,
      image_paths: imagePaths,
      memo: body.memo ?? "",
      updated_at: new Date().toISOString(),
    }, { onConflict: "site_id,report_date" });
    if (e1) throw new Error(e1.message);

    const { error: e2 } = await db().from("dispatches").delete().eq("site_id", site.id).eq("report_date", date);
    if (e2) throw new Error(e2.message);
    if (rows.length) {
      const { error: e3 } = await db().from("dispatches").insert(rows);
      if (e3) throw new Error(e3.message);
    }
    return NextResponse.json({ ok: true, saved: rows.length });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const { date } = await params;
    const { data: report } = await db().from("daily_reports").select("image_paths")
      .eq("site_id", site.id).eq("report_date", date).maybeSingle();
    if (report?.image_paths?.length) await db().storage.from("scans").remove(report.image_paths);
    const { error } = await db().from("daily_reports").delete().eq("site_id", site.id).eq("report_date", date);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
