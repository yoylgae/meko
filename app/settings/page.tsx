"use client";
import { useEffect, useState } from "react";
import type { Company } from "@/lib/form";

export default function Settings() {
  const [list, setList] = useState<Required<Company>[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = () =>
    fetch("/api/companies").then((r) => r.json()).then((d) => { setList(d.companies ?? []); setDirty(false); });
  useEffect(() => { load(); }, []);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setList(n);
    setDirty(true);
  };

  const saveOrder = async () => {
    await fetch("/api/companies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies: list.map((c, i) => ({ id: c.id, sort_order: i, separate: c.separate, frequent: !!c.frequent })) }),
    });
    setMsg("저장했습니다. 다음 인식부터 ★ 업체를 우선합니다.");
    load();
  };

  const add = async () => {
    if (!name.trim()) return;
    const r = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setMsg(r.ok ? `'${name.trim()}' 추가됨` : (await r.json()).error);
    setName("");
    load();
  };

  const setFrequent = (id: number, on: boolean) => {
    setList(list.map((x) => (x.id === id ? { ...x, frequent: on } : x)));
    setDirty(true);
  };
  /** 최근 60일 많이 온 순으로 상위 n곳을 ★ (전체 반출의 90%를 덮는 데까지, 최대 12곳) */
  const autoPick = () => {
    const total = list.reduce((a, c) => a + (c.recent ?? 0), 0);
    if (!total) return setMsg("최근 60일 기록이 없어서 자동으로 고를 수 없습니다. 직접 ★를 눌러 주세요.");
    const ranked = [...list].filter((c) => (c.recent ?? 0) > 0).sort((a, b) => (b.recent ?? 0) - (a.recent ?? 0));
    const pick = new Set<number>();
    let acc = 0;
    for (const c of ranked) {
      if (acc / total >= 0.9 || pick.size >= 12) break;
      pick.add(c.id);
      acc += c.recent ?? 0;
    }
    setList(list.map((x) => ({ ...x, frequent: pick.has(x.id) })));
    setDirty(true);
    setMsg(`최근 60일 반출의 ${Math.round((acc / total) * 100)}%를 차지하는 ${pick.size}곳을 ★로 골랐습니다. 확인 후 저장하세요.`);
  };

  const hide = async (c: Required<Company>) => {
    if (!confirm(`'${c.name}'을(를) 목록에서 뺄까요? 지난 기록은 그대로 남습니다.`)) return;
    await fetch(`/api/companies?id=${c.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h1>업체 목록</h1>
      <p className="sub">
        글씨 인식 때 이 이름 중 가장 가까운 것으로 맞추고, 엑셀 오른쪽 집계표도 이 순서로 만들어집니다.
        <b>★ 자주</b>로 고른 업체는 인식할 때 우선하고, 입력 표 위에 버튼으로 나와 칸을 고른 뒤 눌러서 바로 넣을 수 있어요.
        &lsquo;따로&rsquo;에 체크한 업체(예: 대아)는 집계표 위쪽에 따로 표시됩니다.
      </p>
      <section className="card" style={{ maxWidth: 560 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="새 업체 이름" />
          <button className="ghost" onClick={add}>추가</button>
          <button className="ghost" onClick={autoPick} style={{ marginLeft: "auto" }} title="최근 60일 많이 온 업체를 ★로">★ 최근 기록으로 자동 선택</button>
        </div>
        <table className="grid companies">
          <thead><tr><th>순서</th><th>업체</th><th title="자주 오는 업체">★ 자주</th><th title="최근 60일 반출 대수">최근 60일</th><th>따로</th><th /></tr></thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={c.id}>
                <td className="act">
                  <button className="icon" onClick={() => move(i, -1)} aria-label="위로">▲</button>
                  <button className="icon" onClick={() => move(i, 1)} aria-label="아래로">▼</button>
                </td>
                <td style={{ padding: "6px 10px", fontWeight: c.frequent ? 700 : 400 }}>{c.name}</td>
                <td style={{ textAlign: "center" }}>
                  <button className={`icon star ${c.frequent ? "on" : ""}`} aria-pressed={!!c.frequent}
                    aria-label={`${c.name} 자주 오는 업체`} onClick={() => setFrequent(c.id, !c.frequent)}>{c.frequent ? "★" : "☆"}</button>
                </td>
                <td style={{ textAlign: "right", padding: "6px 10px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{c.recent ?? 0}대</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={c.separate}
                    onChange={(e) => { setList(list.map((x) => (x.id === c.id ? { ...x, separate: e.target.checked } : x))); setDirty(true); }} />
                </td>
                <td className="act"><button className="icon" onClick={() => hide(c)} aria-label="빼기">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={!dirty} onClick={saveOrder}>저장</button>
          <span className="hint">★ {list.filter((c) => c.frequent).length}곳</span>
        </div>
        {msg && <div className="msg">{msg}</div>}
      </section>
    </>
  );
}
