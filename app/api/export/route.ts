import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";
import { addDaySheet, addListSheet, addSummarySheet } from "@/lib/excel";
import type { Company, Dispatch } from "@/lib/form";

export const runtime = "nodejs";

/**
 * 지금 현장의 엑셀 내려받기
 *  ?date=YYYY-MM-DD               → 그날 '폐기물 반출 현황' (기존 양식 그대로)
 *  ?from=YYYY-MM-DD&to=YYYY-MM-DD  → 업체별 집계 + 전체 목록 + 날짜별 시트
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const sp = req.nextUrl.searchParams;
    const from = sp.get("date") ?? sp.get("from");
    const to = sp.get("date") ?? sp.get("to") ?? from;
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to!)) {
      throw new HttpError(400, "날짜를 지정하세요.");
    }

    const { data: comps } = await db().from("companies").select("*")
      .eq("site_id", site.id).eq("active", true).order("sort_order");
    const companies = (comps ?? []) as Company[];

    const { data: rows, error } = await db()
      .from("dispatches")
      .select("report_date, seq, vehicle_no, company, out_time")
      .eq("site_id", site.id)
      .gte("report_date", from)
      .lte("report_date", to!)
      .order("report_date")
      .order("seq")
      .limit(50000);
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new HttpError(404, "해당 날짜에 저장된 기록이 없습니다.");

    const byDate = new Map<string, Dispatch[]>();
    rows.forEach((r) => byDate.set(r.report_date, [...(byDate.get(r.report_date) ?? []), r as Dispatch]));
    const days = [...byDate.entries()].map(([date, rows]) => ({ date, rows }));

    const wb = new ExcelJS.Workbook();
    wb.creator = "폐기물 반출 현황";
    if (days.length > 1) {
      addSummarySheet(wb, days, companies);
      addListSheet(wb, days);
    }
    days.forEach((d) => addDaySheet(wb, d.date, d.rows, companies, { siteName: site.name }));

    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const safeSite = site.name.replace(/[\\/:*?"<>|]/g, "");
    const fname = from === to ? `폐기물반출현황_${safeSite}_${from}.xlsx` : `폐기물반출현황_${safeSite}_${from}_${to}.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
      },
    });
  });
}
