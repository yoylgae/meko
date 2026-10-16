"use client";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "../Shell";
import { koreanDate } from "@/lib/form";

type SiteStat = {
  id: number; name: string; total: number; days: number; lastDate: string | null;
  byCompany: Record<string, number>; byDate: Record<string, number>;
};
type Overview = { from: string; to: string; dates: string[]; total: number; sites: SiteStat[] };

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const ranges = {
  today: () => { const t = ymd(new Date()); return [t, t] as const; },
  week: () => { const n = new Date(); const a = new Date(n); a.setDate(n.getDate() - 6); return [ymd(a), ymd(n)] as const; },
  month: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)] as const; },
  lastMonth: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))] as const; },
};
const daysAgo = (d: string) => Math.round((new Date(ymd(new Date())).getTime() - new Date(d).getTime()) / 86400000);

export default function OverviewPage() {
  const { me } = useMe();
  const [[from, to], setRange] = useState<readonly [string, string]>(ranges.month());
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/overview?from=${from}&to=${to}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) setErr(j.error); else { setErr(""); setData(j); }
    });
  }, [from, to]);

  const max = useMemo(() => Math.max(1, ...(data?.sites.map((s) => s.total) ?? [0])), [data]);
  const companyTotals = useMemo(() => {
    const m: Record<string, number> = {};
    data?.sites.forEach((s) => Object.entries(s.byCompany).forEach(([k, v]) => (m[k] = (m[k] ?? 0) + v)));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const open = async (siteId: number, path: string) => {
    await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId }) });
    location.href = path; // 새로 불러와서 상단 현장 표시까지 바뀌게
  };

  if (me && me.user.role !== "admin") return <section className="card notice"><h2>관리자만 볼 수 있는 화면입니다</h2></section>;

  const single = from === to;
  return (
    <>
      <div className="head">
        <div>
          <h1>전체 현황</h1>
          <p className="sub">모든 현장의 반출 대수를 한눈에 봅니다. 현장을 누르면 그 현장 기록으로 이동해요.</p>
        </div>
      </div>

      <section className="card">
        <div className="row">
          <button className={single && from === ranges.today()[0] ? "small" : "ghost small"} onClick={() => setRange(ranges.today())}>오늘</button>
          <button className="ghost small" onClick={() => setRange(ranges.week())}>최근 7일</button>
          <button className="ghost small" onClick={() => setRange(ranges.month())}>이번 달</button>
          <button className="ghost small" onClick={() => setRange(ranges.lastMonth())}>지난 달</button>
          <label className="f">시작<input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
          <label className="f">끝<input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
          <a href={`/api/admin/export?from=${from}&to=${to}`} style={{ alignSelf: "flex-end" }}>
            <button disabled={!data?.total}>전체 현장 엑셀</button>
          </a>
        </div>
        {data && (
          <div className="period">
            <b>{single ? koreanDate(from) : `${from} ~ ${to}`} · 전체 {data.total.toLocaleString()}대 · {data.sites.filter((s) => s.total).length}/{data.sites.length}개 현장</b>
          </div>
        )}
        {data && companyTotals.length > 0 && (
          <div className="period">{companyTotals.map(([k, v]) => <span key={k} className="chip">{k} {v}</span>)}</div>
        )}
      </section>

      {err && <div className="msg err">{err}</div>}
      {!data && !err && <p className="sub">불러오는 중…</p>}
      {data && !data.sites.length && <p className="sub">아직 현장이 없습니다. &lsquo;관리 → 현장&rsquo;에서 만드세요.</p>}

      <div className="site-grid">
        {data?.sites.map((s) => {
          const stale = s.lastDate ? daysAgo(s.lastDate) : null;
          return (
            <article key={s.id} className="card site-card">
              <header>
                <h3>{s.name}</h3>
                <span className={`last ${stale === null || stale > 1 ? "stale" : ""}`}>
                  {s.lastDate ? (stale === 0 ? "오늘 입력" : stale === 1 ? "어제 입력" : `${stale}일 전 마지막 입력`) : "입력 없음"}
                </span>
              </header>
              <div className="big"><b>{s.total.toLocaleString()}</b>대{!single && s.days > 0 && <span className="meta"> · {s.days}일</span>}</div>
              <div className="bar"><span style={{ width: `${(s.total / max) * 100}%` }} /></div>
              {s.total > 0 && (
                <div className="mini">
                  {Object.entries(s.byCompany).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => <span key={k}>{k} {v}</span>)}
                  {Object.keys(s.byCompany).length > 6 && <span>외 {Object.keys(s.byCompany).length - 6}곳</span>}
                </div>
              )}
              <div className="row">
                <button className="ghost small" onClick={() => open(s.id, "/history")}>기록 보기</button>
                <button className="ghost small" onClick={() => open(s.id, s.lastDate ? `/?date=${s.lastDate}` : "/")}>
                  {s.lastDate ? "마지막 기록 열기" : "입력하러 가기"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
