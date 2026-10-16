"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hangul = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(pw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    setBusy(false);
    if (!r.ok) return setErr((await r.json()).error ?? "로그인 실패");
    const next = params.get("next");
    location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  };

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>로그인</h1>
      <label className="f">이메일
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
          autoComplete="email" autoFocus required />
      </label>
      <label className="f">비밀번호
        <input type={show ? "text" : "password"} value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }}
          autoComplete="current-password" required />
      </label>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> 비밀번호 보기</label>
      {hangul && <div className="msg err">비밀번호에 한글이 입력되고 있어요. 한/영 키를 확인하세요.</div>}
      {err && <div className="msg err">{err}</div>}
      <button disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
      <p className="alt">처음이신가요? <Link href="/signup">가입 신청</Link></p>
      <p className="alt small">비밀번호를 잊었으면 관리자에게 초기화를 요청하세요.</p>
    </form>
  );
}

export default function Login() {
  return <Suspense><LoginForm /></Suspense>;
}
