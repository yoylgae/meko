"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { koreanDate } from "@/lib/form";

type Report = {
  report_date: string;
  written_total: number | null;
  total: number;
  byCompany: Record<string, number>;
};

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthRange = (offset: number) => {
  const n = new Date();
  const a = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const b = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  return [ymd(a), ymd(b)] as const;
};

export default function History() {
  const [[from, to], setRange] = useState<readonly [string, string]>(monthRange(0));
  const [reports, setReports] = useState<Report[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/reports?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : (setErr(""), setReports(d.reports))));
  }, [from, to]);

  const sum = useMemo(() => {
    const m: Record<string, number> = {};
    reports.forEach((r) => Object.entries(r.byCompany).forEach(([k, v]) => (m[k] = (m[k] ?? 0) + v)));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [reports]);
  const total = reports.reduce((a, r) => a + r.total, 0);

  return (
    <>
      <h1>저장된 기록</h1>
      <p className="sub">날짜를 누르면 수정할 수 있어요. 기간 엑셀에는 업체별 집계·전체 목록·날짜별 시트가 들어갑니다.</p>

      <section className="card">
        <div className="row">
          <button className="ghost small" onClick={() => setRange(monthRange(0))}>이번 달</button>
          <button className="ghost small" onClick={() => setRange(monthRange(-1))}>지난 달</button>
          <label className="f">시작<input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
          <label className="f">끝<input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
          <a href={`/api/export?from=${from}&to=${to}`} style={{ alignSelf: "flex-end" }}>
            <button disabled={!reports.length}>기간 엑셀 받기</button>
          </a>
        </div>
        {reports.length > 0 && (
          <div className="period">
            <b>{reports.length}일 · {total.toLocaleString()}대</b>
            {sum.map(([k, v]) => <span key={k} className="chip">{k} {v}</span>)}
          </div>
        )}
      </section>

      {err && <div className="msg err">{err}</div>}
      {!err && !reports.length && <p className="sub">이 기간에 저장된 기록이 없습니다.</p>}

      <ul className="list">
        {reports.map((r) => (
          <li key={r.report_date} className="item">
            <Link href={`/?date=${r.report_date}`} className="item-main">
              <span className="day-name">{koreanDate(r.report_date)}</span>
              <span className="meta">
                {Object.entries(r.byCompany).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}
              </span>
            </Link>
            <span className="item-side">
              <b>{r.total}대</b>
              {r.written_total !== null && r.written_total !== r.total && (
                <span className="warn" title="기록지에 적힌 총댓수와 다름">총댓수 {r.written_total}</span>
              )}
              <a href={`/api/export?date=${r.report_date}`}><button className="ghost small">엑셀</button></a>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
