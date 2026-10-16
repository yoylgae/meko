import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { handle, HttpError, requireAdmin } from "@/lib/access";
import { allDispatches } from "@/lib/overview";

export const runtime = "nodejs";

const ymd = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** 관리자용 전체 현황: 기간 안 현장별 대수·업체별·날짜별 + 각 현장 마지막 입력일 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const from = ymd(req.nextUrl.searchParams.get("from"));
    const to = ymd(req.nextUrl.searchParams.get("to"));
    if (!from || !to) throw new HttpError(400, "기간을 지정하세요.");

    const { sites, rows } = await allDispatches(from, to);

    // 기간과 상관없이 각 현장의 마지막 입력일
    const { data: last } = await db().from("daily_reports").select("site_id, report_date")
      .order("report_date", { ascending: false }).limit(2000);
    const lastDate = new Map<number, string>();
    (last ?? []).forEach((r) => { if (!lastDate.has(r.site_id)) lastDate.set(r.site_id, r.report_date); });

    const dates = [...new Set(rows.map((r) => r.report_date))].sort();
    const result = sites.map((s) => {
      const mine = rows.filter((r) => r.site_id === s.id);
      const byCompany: Record<string, number> = {};
      const byDate: Record<string, number> = {};
      mine.forEach((r) => {
        const c = r.company || "(미기재)";
        byCompany[c] = (byCompany[c] ?? 0) + 1;
        byDate[r.report_date] = (byDate[r.report_date] ?? 0) + 1;
      });
      return {
        id: s.id, name: s.name, total: mine.length, days: Object.keys(byDate).length,
        lastDate: lastDate.get(s.id) ?? null, byCompany, byDate,
      };
    });
    return NextResponse.json({ from, to, dates, total: rows.length, sites: result });
  });
}
