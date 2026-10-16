"use client";
import { useEffect, useState } from "react";
import { useMe } from "../Shell";

type User = {
  user_id: string; email: string; name: string; note: string;
  role: "admin" | "member"; status: "pending" | "active" | "disabled";
  created_at: string; siteIds: number[];
};
type SiteRow = { id: number; name: string; active: boolean; members: number };

const STATUS = { pending: "승인 대기", active: "사용 중", disabled: "정지" } as const;
const day = (s: string) => s.slice(0, 10);

export default function Admin() {
  const { me, reload: reloadMe } = useMe();
  const [users, setUsers] = useState<User[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [editing, setEditing] = useState<Record<string, number[]>>({}); // userId → 고른 현장
  const [newSite, setNewSite] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [tab, setTab] = useState<"users" | "sites">("users");

  const load = async () => {
    const [u, s] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/sites")]);
    const uj = await u.json(), sj = await s.json();
    if (!u.ok) return setMsg({ text: uj.error, err: true });
    setUsers(uj.users);
    setSites(sj.sites ?? []);
  };
  useEffect(() => { load(); }, []);

  const call = async (url: string, method: string, body?: unknown, ok?: string) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ text: j.error ?? "실패", err: true }); return null; }
    if (ok) setMsg({ text: ok });
    await load();
    reloadMe(); // 내 현장 배정이 바뀌었을 수 있음
    return j;
  };

  const activeSites = sites.filter((s) => s.active);
  const pending = users.filter((u) => u.status === "pending");
  const others = users.filter((u) => u.status !== "pending");

  const picker = (u: User) => {
    const sel = editing[u.user_id] ?? u.siteIds;
    return (
      <div className="site-checks">
        {activeSites.map((s) => (
          <label key={s.id} className={`chip pick ${sel.includes(s.id) ? "sel" : ""}`}>
            <input type="checkbox" checked={sel.includes(s.id)}
              onChange={(e) => setEditing({ ...editing, [u.user_id]: e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id) })} />
            {s.name}
          </label>
        ))}
        {!activeSites.length && <span className="hint">먼저 &lsquo;현장&rsquo; 탭에서 현장을 만드세요.</span>}
      </div>
    );
  };
  const changed = (u: User) => {
    const sel = editing[u.user_id];
    return sel && (sel.length !== u.siteIds.length || sel.some((x) => !u.siteIds.includes(x)));
  };
  const siteName = (id: number) => sites.find((s) => s.id === id)?.name ?? `#${id}`;

  const resetPw = async (u: User) => {
    if (!confirm(`${u.name}(${u.email})의 비밀번호를 임시 비밀번호로 바꿀까요?`)) return;
    const j = await call("/api/admin/users/reset", "POST", { userId: u.user_id });
    if (j?.password) {
      setMsg({ text: `${u.name}님 임시 비밀번호: ${j.password}  — 지금만 보입니다. 전달 후 '비밀번호 변경'에서 바꾸게 하세요.` });
    }
  };

  return (
    <>
      <h1>관리</h1>
      <p className="sub">가입 승인과 현장 배정을 합니다. 각 현장의 기록은 그 현장에 배정된 사람만 볼 수 있어요.</p>

      <div className="tabs">
        <button className={tab === "users" ? "" : "ghost"} onClick={() => setTab("users")}>
          계정 {pending.length > 0 && <span className="badge">{pending.length}</span>}
        </button>
        <button className={tab === "sites" ? "" : "ghost"} onClick={() => setTab("sites")}>현장 {activeSites.length}</button>
      </div>
      {msg && <div className={`msg ${msg.err ? "err" : ""}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      {tab === "users" && <>
        {pending.length > 0 && (
          <section className="card">
            <h2>승인 대기 {pending.length}명</h2>
            {pending.map((u) => (
              <div key={u.user_id} className="urow">
                <div className="uinfo">
                  <b>{u.name}</b> <span className="meta">{u.email} · {day(u.created_at)} 신청</span>
                  {u.note && <div className="note">소속: {u.note}</div>}
                </div>
                {picker(u)}
                <div className="row">
                  <button disabled={!(editing[u.user_id] ?? []).length}
                    onClick={() => call("/api/admin/users", "PATCH",
                      { userId: u.user_id, status: "active", siteIds: editing[u.user_id] }, `${u.name}님을 승인했습니다.`)}>
                    승인
                  </button>
                  <button className="danger" onClick={() => confirm(`${u.name}님의 가입 신청을 거절(삭제)할까요?`) &&
                    call(`/api/admin/users?id=${u.user_id}`, "DELETE", undefined, "가입 신청을 거절했습니다.")}>거절</button>
                  {!(editing[u.user_id] ?? []).length && <span className="hint">현장을 하나 이상 골라야 승인할 수 있어요</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="card">
          <h2>계정 {others.length}명</h2>
          {others.map((u) => {
            const self = u.email === me?.user.email;
            const isEditing = editing[u.user_id] !== undefined;
            return (
              <div key={u.user_id} className={`urow ${u.status === "disabled" ? "off" : ""}`}>
                <div className="uinfo">
                  <b>{u.name}</b>{" "}
                  {u.role === "admin" && <span className="tag">관리자</span>}{" "}
                  {u.status === "disabled" && <span className="tag warn-tag">{STATUS[u.status]}</span>}
                  <div className="meta">{u.email}{u.note ? ` · ${u.note}` : ""}</div>
                </div>
                {isEditing ? picker(u) : (
                  <div className="site-checks">
                    {u.siteIds.length ? u.siteIds.map((id) => <span key={id} className="chip">{siteName(id)}</span>)
                      : <span className="hint">배정된 현장 없음</span>}
                  </div>
                )}
                <div className="row">
                  {isEditing ? <>
                    <button disabled={!changed(u)} onClick={async () => {
                      await call("/api/admin/users", "PATCH", { userId: u.user_id, siteIds: editing[u.user_id] }, `${u.name}님 현장 배정을 저장했습니다.`);
                      const n = { ...editing }; delete n[u.user_id]; setEditing(n);
                    }}>배정 저장</button>
                    <button className="ghost" onClick={() => { const n = { ...editing }; delete n[u.user_id]; setEditing(n); }}>취소</button>
                  </> : <button className="ghost small" onClick={() => setEditing({ ...editing, [u.user_id]: u.siteIds })}>현장 배정</button>}
                  <button className="ghost small" onClick={() => resetPw(u)}>비밀번호 초기화</button>
                  {!self && (u.status === "active"
                    ? <button className="ghost small" onClick={() => confirm(`${u.name}님 계정을 정지할까요? 바로 로그아웃됩니다.`) &&
                        call("/api/admin/users", "PATCH", { userId: u.user_id, status: "disabled" }, "정지했습니다.")}>정지</button>
                    : <button className="ghost small" onClick={() => call("/api/admin/users", "PATCH", { userId: u.user_id, status: "active" }, "다시 사용하도록 했습니다.")}>정지 해제</button>)}
                  {!self && (u.role === "admin"
                    ? <button className="ghost small" onClick={() => call("/api/admin/users", "PATCH", { userId: u.user_id, role: "member" }, "관리자 권한을 해제했습니다.")}>관리자 해제</button>
                    : <button className="ghost small" onClick={() => confirm(`${u.name}님을 관리자로 지정할까요? 계정 승인·현장 관리를 할 수 있게 됩니다.`) &&
                        call("/api/admin/users", "PATCH", { userId: u.user_id, role: "admin" }, "관리자로 지정했습니다.")}>관리자 지정</button>)}
                </div>
              </div>
            );
          })}
        </section>
      </>}

      {tab === "sites" && (
        <section className="card" style={{ maxWidth: 640 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="새 현장 이름"
              onKeyDown={(e) => e.key === "Enter" && newSite.trim() && call("/api/admin/sites", "POST", { name: newSite }, `'${newSite.trim()}' 현장을 만들었습니다.`).then(() => setNewSite(""))} />
            <button disabled={!newSite.trim()} onClick={() => call("/api/admin/sites", "POST", { name: newSite }, `'${newSite.trim()}' 현장을 만들었습니다.`).then(() => setNewSite(""))}>현장 추가</button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>새 현장에는 기본 업체 목록이 들어갑니다. 현장 담당자가 &lsquo;업체&rsquo; 화면에서 고칠 수 있어요.</p>
          <table className="grid companies">
            <thead><tr><th>현장</th><th>배정 인원</th><th /></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} className={s.active ? "" : "off"}>
                  <td style={{ padding: "8px 10px" }}>{s.name}{!s.active && <span className="tag">운영 종료</span>}</td>
                  <td style={{ padding: "8px 10px" }}>{s.members}명</td>
                  <td className="act" style={{ width: 200 }}>
                    <button className="ghost small" onClick={() => {
                      const n = prompt("새 현장 이름", s.name);
                      if (n && n.trim() && n.trim() !== s.name) call("/api/admin/sites", "PATCH", { id: s.id, name: n }, "이름을 바꿨습니다.");
                    }}>이름 변경</button>{" "}
                    {s.active
                      ? <button className="ghost small" onClick={() => confirm(`'${s.name}' 현장을 운영 종료할까요? 담당자 화면에서 사라지지만 기록은 지워지지 않습니다.`) &&
                          call("/api/admin/sites", "PATCH", { id: s.id, active: false }, "운영 종료했습니다.")}>종료</button>
                      : <button className="ghost small" onClick={() => call("/api/admin/sites", "PATCH", { id: s.id, active: true }, "다시 운영합니다.")}>재개</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
