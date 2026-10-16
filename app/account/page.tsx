"use client";
import { useState } from "react";
import { useMe } from "../Shell";

export default function Account() {
  const { me } = useMe();
  const [f, setF] = useState({ current: "", next: "", next2: "" });
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.next2) return setMsg({ text: "새 비밀번호 확인이 일치하지 않습니다.", err: true });
    const r = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: f.current, next: f.next }),
    });
    const j = await r.json();
    if (!r.ok) return setMsg({ text: j.error, err: true });
    setF({ current: "", next: "", next2: "" });
    setMsg({ text: "비밀번호를 바꿨습니다." });
  };

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>비밀번호 변경</h1>
      <p className="sub">{me?.user.email}</p>
      <label className="f">지금 비밀번호 (관리자가 알려 준 임시 비밀번호 포함)
        <input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" required />
      </label>
      <label className="f">새 비밀번호 (8자 이상)
        <input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" minLength={8} required />
      </label>
      <label className="f">새 비밀번호 확인
        <input type="password" value={f.next2} onChange={(e) => setF({ ...f, next2: e.target.value })} autoComplete="new-password" required />
      </label>
      {msg && <div className={`msg ${msg.err ? "err" : ""}`}>{msg.text}</div>}
      <button>바꾸기</button>
    </form>
  );
}
