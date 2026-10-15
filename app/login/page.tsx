"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [err, setErr] = useState("");
  const hangul = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(pw);

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
    <form className="card" style={{ maxWidth: 380, margin: "60px auto" }} onSubmit={submit}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>비밀번호를 입력하세요</h2>
      <div className="row">
        <input
          type={show ? "text" : "password"}
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1 }}
        />
        <button>들어가기</button>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> 비밀번호 보기
      </label>
      {hangul && <div className="msg err">한글이 입력되고 있어요. 한/영 키를 눌러 영문으로 바꾼 뒤 다시 입력하세요.</div>}
      {caps && !hangul && <div className="msg">Caps Lock이 켜져 있어요.</div>}
      {err && <div className="msg err">{err}</div>}
    </form>
  );
}
