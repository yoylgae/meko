import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 인식기 재학습용 내려받기: 그날 저장된 기록 + 그날 올린 기록지 사진(올린 순서)
 * GET /api/train-data?site=1&date=2026-11-07   머리글 x-train-key 필요 (관리자 PC·학습 스크립트 전용)
 */
export async function GET(req: NextRequest) {
  const key = process.env.TRAIN_EXPORT_KEY ?? "";
  const got = req.headers.get("x-train-key") ?? "";
  if (!key || got.length !== key.length || !timingSafeEqual(Buffer.from(got), Buffer.from(key))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const site = Number(req.nextUrl.searchParams.get("site") ?? "1");
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date" }, { status: 400 });

  const { data: rows, error } = await db().from("dispatches").select("seq, vehicle_no, company, out_time")
    .eq("site_id", site).eq("report_date", date).order("seq");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: files } = await db().storage.from("scans").list(`site-${site}/${date}`, { sortBy: { column: "created_at", order: "asc" } });
  const images = [];
  for (const f of files ?? []) {
    const path = `site-${site}/${date}/${f.name}`;
    const { data: blob } = await db().storage.from("scans").download(path);
    if (!blob) continue;
    images.push({ path, created_at: f.created_at, base64: Buffer.from(await blob.arrayBuffer()).toString("base64") });
  }
  return NextResponse.json({ rows: rows ?? [], images });
}
