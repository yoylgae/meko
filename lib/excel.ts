import type ExcelJS from "exceljs";
import { koreanDate, timeToMinutes, type Company, type Dispatch } from "./form";

const PER_BLOCK = 16;           // 묶음당 줄 수
const BLOCKS = 6;               // 가로 묶음 수
const PER_SECTION = PER_BLOCK * BLOCKS; // 96
const MIN_SECTIONS = 3;

const FONT = "맑은 고딕";
const GRAY = "FFD9D9D9";
const thin = { style: "thin" as const, color: { argb: "FF7F7F7F" } };
const medium = { style: "medium" as const, color: { argb: "FF000000" } };
const allThin = { top: thin, left: thin, bottom: thin, right: thin };

const col = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** 엑셀 시간값(하루=1) */
const excelTime = (t: string) => {
  const m = timeToMinutes(t);
  return m === null ? t : m / 1440;
};
const vehicleCell = (v: string) => (/^[1-9]\d*$/.test(v) ? Number(v) : v);

/**
 * 하루치 '폐기물 반출 현황' 시트 — 기존 엑셀 양식과 같은 배치
 *  A~X: [연번|차량번호|업체|시간] × 6묶음, 16줄씩, 96건마다 다음 구역
 *  Z~AA: 금일합계, 따로 표시 업체(대아), 업체별 대수 (COUNTIF 수식)
 */
export function addDaySheet(wb: ExcelJS.Workbook, date: string, rows: Dispatch[], companies: Company[],
  opts: { sheetName?: string; siteName?: string } = {}) {
  const ws = wb.addWorksheet(opts.sheetName ?? date, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });

  // 열 너비
  for (let g = 0; g < BLOCKS; g++) {
    ws.getColumn(1 + g * 4).width = 5;
    ws.getColumn(2 + g * 4).width = 8.5;
    ws.getColumn(3 + g * 4).width = 7.5;
    ws.getColumn(4 + g * 4).width = 7;
  }
  ws.getColumn(25).width = 3;  // Y
  ws.getColumn(26).width = 10; // Z
  ws.getColumn(27).width = 8;  // AA

  // 제목줄
  ws.mergeCells("A1:U1");
  ws.mergeCells("V1:X1");
  ws.getCell("A1").value = opts.siteName ? `폐기물 반출 현황 (${opts.siteName})` : "폐기물 반출 현황";
  ws.getCell("A1").font = { name: FONT, size: 12, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("V1").value = koreanDate(date);
  ws.getCell("V1").font = { name: FONT, size: 10, bold: true };
  ws.getCell("V1").alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(1).height = 24;

  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const sections = Math.max(MIN_SECTIONS, Math.ceil(sorted.length / PER_SECTION));
  const headerRow = (s: number) => 2 + s * (PER_BLOCK + 1);
  const lastRow = headerRow(sections - 1) + PER_BLOCK;

  for (let s = 0; s < sections; s++) {
    const hr = headerRow(s);
    ws.getRow(hr).height = 18;
    for (let g = 0; g < BLOCKS; g++) {
      ["연번", "차량번호", "업체", "시간"].forEach((h, k) => {
        const c = ws.getCell(hr, 1 + g * 4 + k);
        c.value = h;
        c.font = { name: FONT, size: 9, bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = { ...allThin, top: medium, bottom: medium };
      });
      for (let r = 0; r < PER_BLOCK; r++) {
        const rowNo = hr + 1 + r;
        const seq = s * PER_SECTION + g * PER_BLOCK + r + 1;
        const d = sorted[seq - 1];
        const cells = [
          seq,
          d ? vehicleCell(d.vehicle_no) : null,
          d ? d.company || null : null,
          d && d.out_time ? excelTime(d.out_time) : null,
        ];
        cells.forEach((v, k) => {
          const c = ws.getCell(rowNo, 1 + g * 4 + k);
          c.value = v as ExcelJS.CellValue;
          c.font = { name: FONT, size: 9, bold: k === 0 };
          c.alignment = { horizontal: "center", vertical: "middle" };
          c.border = r === PER_BLOCK - 1 ? { ...allThin, bottom: medium } : allThin;
          if (k === 0) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
          if (k === 3) c.numFmt = "h:mm";
        });
        ws.getRow(rowNo).height = 16.5;
      }
    }
  }

  // ── 오른쪽 집계 ──
  const range = `$A$3:$X$${lastRow}`;
  const box = (r: number, label: string, formula: string | null, result: number) => {
    const a = ws.getCell(r, 26), b = ws.getCell(r, 27);
    a.value = label || null;
    b.value = formula ? { formula, result } : result;
    [a, b].forEach((c) => {
      c.font = { name: FONT, size: 9, bold: true };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = { top: medium, bottom: medium, left: medium, right: medium };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
    });
  };

  const vehicleCols = Array.from({ length: BLOCKS }, (_, g) => `${col(2 + g * 4)}3:${col(2 + g * 4)}${lastRow}`);
  box(2, "금일합계", `COUNTA(${vehicleCols.join(",")})-${BLOCKS * (sections - 1)}`, sorted.filter((d) => d.vehicle_no).length);

  const count = (name: string) => sorted.filter((d) => d.company === name).length;
  const active = [...companies].sort((a, b) => a.sort_order - b.sort_order);
  const separate = active.filter((c) => c.separate);
  const main = active.filter((c) => !c.separate).map((c) => c.name);
  // 목록에 없는 업체가 적혀 있으면 집계표 끝에 덧붙여 합계가 맞게
  const known = new Set(active.map((c) => c.name));
  sorted.forEach((d) => d.company && !known.has(d.company) && !main.includes(d.company) && main.push(d.company));

  let r = 4;
  for (const c of separate) { box(r, c.name, `COUNTIF(${range},Z${r})`, count(c.name)); r++; }
  if (separate.length) r++;
  const firstMain = r;
  for (const name of main) { box(r, name, `COUNTIF(${range},Z${r})`, count(name)); r++; }
  for (let i = 0; i < 2; i++) { box(r, "", null, 0); r++; } // 기존 양식처럼 빈 칸 2개

  // 바깥 굵은 테두리 정리
  for (let rr = firstMain; rr < r; rr++) {
    ws.getCell(rr, 26).border = { top: thin, bottom: thin, left: medium, right: thin };
    ws.getCell(rr, 27).border = { top: thin, bottom: thin, left: thin, right: medium };
  }
  ws.getCell(firstMain, 26).border = { ...ws.getCell(firstMain, 26).border, top: medium };
  ws.getCell(firstMain, 27).border = { ...ws.getCell(firstMain, 27).border, top: medium };
  ws.getCell(r - 1, 26).border = { ...ws.getCell(r - 1, 26).border, bottom: medium };
  ws.getCell(r - 1, 27).border = { ...ws.getCell(r - 1, 27).border, bottom: medium };

  ws.pageSetup.printArea = `A1:X${lastRow}`;
  return ws;
}

/** 기간 묶음용: 전체 목록 시트 */
export function addListSheet(wb: ExcelJS.Workbook, days: { date: string; rows: Dispatch[] }[]) {
  const ws = wb.addWorksheet("전체 목록", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "날짜", key: "date", width: 12 },
    { header: "연번", key: "seq", width: 6 },
    { header: "차량번호", key: "vehicle", width: 10 },
    { header: "업체", key: "company", width: 10 },
    { header: "시간", key: "time", width: 8 },
  ];
  for (const d of days)
    for (const r of [...d.rows].sort((a, b) => a.seq - b.seq))
      ws.addRow({ date: d.date, seq: r.seq, vehicle: vehicleCell(r.vehicle_no), company: r.company, time: r.out_time ? excelTime(r.out_time) : null });
  ws.getColumn("time").numFmt = "h:mm";
  ws.getRow(1).font = { name: FONT, bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
  ws.autoFilter = { from: "A1", to: "E1" };
}

/** 기간 묶음용: 날짜 × 업체 집계 */
export function addSummarySheet(wb: ExcelJS.Workbook, days: { date: string; rows: Dispatch[] }[], companies: Company[]) {
  const ws = wb.addWorksheet("업체별 집계", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const names = [...companies].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.name);
  days.forEach((d) => d.rows.forEach((r) => r.company && !names.includes(r.company) && names.push(r.company)));
  const used = names.filter((n) => days.some((d) => d.rows.some((r) => r.company === n)));

  ws.addRow(["날짜", "합계", ...used]);
  days.forEach((d) => {
    ws.addRow([d.date, d.rows.length, ...used.map((n) => d.rows.filter((r) => r.company === n).length)]);
  });
  const last = days.length + 1;
  const sumRow = ws.addRow(["합계", ...[0, ...used.map(() => 0)].map((_, i) => ({
    formula: `SUM(${col(2 + i)}2:${col(2 + i)}${last})`,
    result: i === 0 ? days.reduce((a, d) => a + d.rows.length, 0)
      : days.reduce((a, d) => a + d.rows.filter((r) => r.company === used[i - 1]).length, 0),
  }))]);
  [ws.getRow(1), sumRow].forEach((row) => {
    row.font = { name: FONT, bold: true };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
  });
  ws.getColumn(1).width = 12;
  for (let i = 2; i <= used.length + 2; i++) ws.getColumn(i).width = 8;
}
