import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

/** 날짜별 목록 + 업체별 대수. ?from=&to= */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  let q = db()
    .from("daily_reports")
    .select("report_date, written_total, updated_at, dispatches(company)")
    .order("report_date", { ascending: false })
    .limit(400);
  if (from) q = q.gte("report_date", from);
  if (to) q = q.lte("report_date", to);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reports = (data ?? []).map((r) => {
    const byCompany: Record<string, number> = {};
    (r.dispatches as { company: string }[]).forEach((d) => {
      byCompany[d.company || "(미기재)"] = (byCompany[d.company || "(미기재)"] ?? 0) + 1;
    });
    return {
      report_date: r.report_date,
      written_total: r.written_total,
      updated_at: r.updated_at,
      total: (r.dispatches as unknown[]).length,
      byCompany,
    };
  });
  return NextResponse.json({ reports });
}
