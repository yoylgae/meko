"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export type Me = {
  user: { email: string; name: string; role: "admin" | "member"; status: "pending" | "active" | "disabled" };
  sites: { id: number; name: string }[];
  siteId: number | null;
};

const MeContext = createContext<{ me: Me | null; reload: () => void }>({ me: null, reload: () => {} });
export const useMe = () => useContext(MeContext);

const PUBLIC = ["/login", "/signup"];
const SITE_PAGES = ["/", "/history", "/settings"];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.includes(path);
  const [me, setMe] = useState<Me | null>(null);
  const [menu, setMenu] = useState(false);

  const load = () => {
    fetch("/api/me").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      setMe(await r.json());
    });
  };
  useEffect(() => { if (!isPublic) load(); }, [isPublic]); // eslint-disable-line react-hooks/exhaustive-deps

  // 승인 전이면 대기 화면으로, 관리자인데 배정 현장이 없으면 관리 화면으로
  useEffect(() => {
    if (!me || isPublic) return;
    if (me.user.status !== "active" && path !== "/pending" && path !== "/account") router.replace("/pending");
    else if (me.user.status === "active" && path === "/pending") router.replace("/");
    else if (me.user.status === "active" && !me.sites.length && me.user.role === "admin" && SITE_PAGES.includes(path)) router.replace("/admin");
  }, [me, path, isPublic, router]);

  const switchSite = async (id: number) => {
    const r = await fetch("/api/me", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: id }),
    });
    if (r.ok) location.reload(); // 화면의 데이터를 새 현장 것으로 다시 불러옴 (저장 안 한 내용은 브라우저가 경고)
  };
  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/login";
  };

  if (isPublic) {
    return (
      <>
        <header className="top"><span className="brand">폐기물 반출 현황</span></header>
        <main>{children}</main>
      </>
    );
  }

  const active = me?.user.status === "active";
  const hasSites = !!me?.sites.length;
  const isAdmin = me?.user.role === "admin";
  const current = me?.sites.find((s) => s.id === me.siteId);
  const blockSitePage = me && active && !hasSites && SITE_PAGES.includes(path) && !isAdmin;
  const blockAdmin = me && (path.startsWith("/admin") || path === "/overview") && !(active && isAdmin);

  return (
    <MeContext.Provider value={{ me, reload: load }}>
      <header className="top">
        <div className="top-left">
          <Link href="/" className="brand">폐기물 반출 현황</Link>
          {active && hasSites && (
            me!.sites.length > 1 ? (
              <select className="site-pick" value={me!.siteId ?? ""} onChange={(e) => switchSite(Number(e.target.value))} aria-label="현장 선택">
                {me!.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <span className="site-name">{current?.name}</span>
          )}
        </div>
        <nav>
          {active && hasSites && <>
            <Link href="/" className={path === "/" ? "on" : ""}>입력</Link>
            <Link href="/history" className={path === "/history" ? "on" : ""}>기록</Link>
            <Link href="/settings" className={path === "/settings" ? "on" : ""}>업체</Link>
          </>}
          {active && isAdmin && <>
            <Link href="/overview" className={path === "/overview" ? "on" : ""}>전체 현황</Link>
            <Link href="/admin" className={path.startsWith("/admin") ? "on" : ""}>관리</Link>
          </>}
          {me && (
            <span className="user-menu">
              <button className="icon user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
                {me.user.name || me.user.email} ▾
              </button>
              {menu && (
                <span className="menu" onClick={() => setMenu(false)}>
                  <span className="menu-email">{me.user.email}</span>
                  <Link href="/account">비밀번호 변경</Link>
                  <button className="linkish plain" onClick={logout}>로그아웃</button>
                </span>
              )}
            </span>
          )}
        </nav>
      </header>
      <main>
        {!me ? <p className="sub">불러오는 중…</p>
          : blockSitePage ? (
            <section className="card notice">
              <h2>배정된 현장이 없습니다</h2>
              <p>관리자에게 현장 배정을 요청하세요. 배정되면 이 화면을 새로고침하면 됩니다.</p>
            </section>
          ) : blockAdmin ? (
            <section className="card notice"><h2>관리자만 볼 수 있는 화면입니다</h2></section>
          ) : children}
      </main>
    </MeContext.Provider>
  );
}
