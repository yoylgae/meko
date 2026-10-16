"use client";
import { useState } from "react";
import Link from "next/link";

export default function Signup() {
  const [f, setF] = useState({ name: "", email: "", password: "", password2: "", note: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setErr(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.password2) return setErr("비밀번호 확인이 일치하지 않습니다.");
    setBusy(true);
    const r = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, email: f.email, password: f.password, note: f.note }),
    });
    setBusy(false);
    if (!r.ok) return setErr((await r.json()).error ?? "가입 실패");
    location.href = "/";
  };

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>가입 신청</h1>
      <p className="sub">가입하면 관리자가 확인하고 현장을 배정해 드립니다. 그 전까지는 승인 대기 상태예요.</p>
      <label className="f">이름<input value={f.name} onChange={set("name")} autoComplete="name" required /></label>
      <label className="f">이메일<input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></label>
      <label className="f">비밀번호 (8자 이상)
        <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" minLength={8} required />
      </label>
      <label className="f">비밀번호 확인
        <input type="password" value={f.password2} onChange={set("password2")} autoComplete="new-password" required />
      </label>
      <label className="f">소속 현장 (관리자가 배정할 때 참고)
        <input value={f.note} onChange={set("note")} placeholder="예: 한남 2구역" />
      </label>
      {err && <div className="msg err">{err}</div>}
      <button disabled={busy}>{busy ? "신청 중…" : "가입 신청"}</button>
      <p className="alt">이미 계정이 있나요? <Link href="/login">로그인</Link></p>
    </form>
  );
}
