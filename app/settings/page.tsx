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
      body: JSON.stringify({ companies: list.map((c, i) => ({ id: c.id, sort_order: i, separate: c.separate })) }),
    });
    setMsg("순서를 저장했습니다.");
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
        &lsquo;따로&rsquo;에 체크한 업체(예: 대아)는 집계표 위쪽에 따로 표시됩니다.
      </p>
      <section className="card" style={{ maxWidth: 460 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="새 업체 이름" />
          <button className="ghost" onClick={add}>추가</button>
        </div>
        <table className="grid companies">
          <thead><tr><th>순서</th><th>업체</th><th>따로</th><th /></tr></thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={c.id}>
                <td className="act">
                  <button className="icon" onClick={() => move(i, -1)} aria-label="위로">▲</button>
                  <button className="icon" onClick={() => move(i, 1)} aria-label="아래로">▼</button>
                </td>
                <td style={{ padding: "6px 10px" }}>{c.name}</td>
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
          <button disabled={!dirty} onClick={saveOrder}>순서·따로 표시 저장</button>
        </div>
        {msg && <div className="msg">{msg}</div>}
      </section>
    </>
  );
}
