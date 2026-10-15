"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) location.href = "/";
    else setErr((await r.json()).error ?? "로그인 실패");
  };
  return (
    <form className="card" style={{ maxWidth: 360, margin: "60px auto" }} onSubmit={submit}>
      <h2>비밀번호를 입력하세요</h2>
      <div className="row">
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus style={{ flex: 1 }} />
        <button>들어가기</button>
      </div>
      {err && <div className="msg err">{err}</div>}
    </form>
  );
}
