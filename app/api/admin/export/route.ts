import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { handle, HttpError, requireAdmin } from "@/lib/access";
import { allDispatches } from "@/lib/overview";

export const runtime = "nodejs";
export const maxDuration = 60;

const FONT = "맑은 고딕";
const GRAY = "FFD9D9D9";
const ymd = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const col = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** 관리자용: 기간 안 전 현장 합산 엑셀 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req);
    const from = ymd(req.nextUrl.searchParams.get("from"));
    const to = ymd(req.nextUrl.searchParams.get("to"));
    if (!from || !to) throw new HttpError(400, "기간을 지정하세요.");
    const { sites, rows } = await allDispatches(from, to);
    if (!rows.length) throw new HttpError(404, "이 기간에 저장된 기록이 없습니다.");

    const used = sites.filter((s) => rows.some((r) => r.site_id === s.id));
    const name = (id: number) => sites.find((s) => s.id === id)?.name ?? `#${id}`;
    const companies = [...new Set(rows.map((r) => r.company || "(미기재)"))]
      .sort((a, b) => rows.filter((r) => (r.company || "(미기재)") === b).length - rows.filter((r) => (r.company || "(미기재)") === a).length);
    const dates = [...new Set(rows.map((r) => r.report_date))].sort();
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;

    const wb = new ExcelJS.Workbook();
    wb.creator = "폐기물 반출 현황";
    const style = (ws: ExcelJS.Worksheet, sumRow?: number) => {
      [1, sumRow].forEach((r) => {
        if (!r) return;
        const row = ws.getRow(r);
        row.font = { name: FONT, bold: true };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
      });
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    };
    const sumFormulas = (ws: ExcelJS.Worksheet, nCols: number, lastDataRow: number, label = "합계") => {
      const r = ws.addRow([label]);
      for (let c = 2; c <= nCols; c++) {
        const L = col(c);
        let result = 0;
        for (let i = 2; i <= lastDataRow; i++) result += Number(ws.getRow(i).getCell(c).value) || 0;
        r.getCell(c).value = { formula: `SUM(${L}2:${L}${lastDataRow})`, result };
      }
      return r.number;
    };

    // 1) 현장 × 업체
    const ws1 = wb.addWorksheet("현장별 업체 집계");
    ws1.addRow(["현장", "합계", "입력일수", ...companies]);
    used.forEach((s) => ws1.addRow([
      s.name,
      count((r) => r.site_id === s.id),
      new Set(rows.filter((r) => r.site_id === s.id).map((r) => r.report_date)).size,
      ...companies.map((c) => count((r) => r.site_id === s.id && (r.company || "(미기재)") === c)),
    ]));
    const s1 = sumFormulas(ws1, companies.length + 3, used.length + 1);
    ws1.getRow(s1).getCell(3).value = dates.length; // 입력일수 합계는 고유 날짜 수
    ws1.getColumn(1).width = 16;
    for (let c = 2; c <= companies.length + 3; c++) ws1.getColumn(c).width = 8;
    style(ws1, s1);

    // 2) 날짜 × 현장
    const ws2 = wb.addWorksheet("날짜별 현장 집계");
    ws2.addRow(["날짜", "합계", ...used.map((s) => s.name)]);
    dates.forEach((d) => ws2.addRow([d, count((r) => r.report_date === d), ...used.map((s) => count((r) => r.report_date === d && r.site_id === s.id))]));
    const s2 = sumFormulas(ws2, used.length + 2, dates.length + 1);
    ws2.getColumn(1).width = 12;
    for (let c = 2; c <= used.length + 2; c++) ws2.getColumn(c).width = 12;
    style(ws2, s2);

    // 3) 전체 목록
    const ws3 = wb.addWorksheet("전체 목록", { views: [{ state: "frozen", ySplit: 1 }] });
    ws3.columns = [
      { header: "현장", key: "site", width: 16 },
      { header: "날짜", key: "date", width: 12 },
      { header: "연번", key: "seq", width: 6 },
      { header: "차량번호", key: "vehicle", width: 10 },
      { header: "업체", key: "company", width: 10 },
      { header: "시간", key: "time", width: 8 },
    ];
    rows.forEach((r) => {
      const m = r.out_time.match(/^(\d{1,2}):(\d{2})$/);
      ws3.addRow({
        site: name(r.site_id), date: r.report_date, seq: r.seq,
        vehicle: /^[1-9]\d*$/.test(r.vehicle_no) ? Number(r.vehicle_no) : r.vehicle_no,
        company: r.company, time: m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : r.out_time,
      });
    });
    ws3.getColumn("time").numFmt = "h:mm";
    ws3.getRow(1).font = { name: FONT, bold: true };
    ws3.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
    ws3.autoFilter = { from: "A1", to: "F1" };

    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const fname = from === to ? `폐기물반출_전체현장_${from}.xlsx` : `폐기물반출_전체현장_${from}_${to}.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
      },
    });
  });
}
