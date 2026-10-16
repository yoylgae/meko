import { NextRequest, NextResponse } from "next/server";
import { db } from "./supabase";
import { SESSION_COOKIE, SITE_COOKIE, verifySessionToken } from "./session";

export type Profile = {
  user_id: string;
  email: string;
  name: string;
  note: string;
  role: "admin" | "member";
  status: "pending" | "active" | "disabled";
  created_at: string;
  approved_at: string | null;
};
export type Site = { id: number; name: string; active: boolean };

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 라우트 안에서 throw한 HttpError를 JSON 응답으로 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: (e as Error).message ?? "서버 오류" }, { status: 500 });
  }
}

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** 세션의 계정 (승인 상태와 무관). 로그인 안 했으면 401 */
export async function sessionProfile(req: NextRequest): Promise<Profile> {
  const uid = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!uid) throw new HttpError(401, "로그인이 필요합니다.");
  const { data } = await db().from("profiles").select("*").eq("user_id", uid).maybeSingle();
  if (!data) throw new HttpError(401, "계정을 찾을 수 없습니다. 다시 로그인하세요.");
  return data as Profile;
}

/** 승인된 계정만 */
export async function activeUser(req: NextRequest): Promise<Profile> {
  const p = await sessionProfile(req);
  if (p.status === "disabled") throw new HttpError(403, "사용이 정지된 계정입니다. 관리자에게 문의하세요.");
  if (p.status !== "active") throw new HttpError(403, "관리자 승인을 기다리는 중입니다.");
  return p;
}

export async function requireAdmin(req: NextRequest): Promise<Profile> {
  const p = await activeUser(req);
  if (p.role !== "admin") throw new HttpError(403, "관리자만 사용할 수 있습니다.");
  return p;
}

/** 이 계정이 배정된(운영 중인) 현장 목록 */
export async function memberSites(userId: string): Promise<Site[]> {
  const { data, error } = await db()
    .from("site_members")
    .select("sites(id, name, active)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => (Array.isArray(r.sites) ? r.sites[0] : r.sites) as Site | null)
    .filter((s): s is Site => !!s && s.active)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 운영 중인 전체 현장 */
export async function allSites(): Promise<Site[]> {
  const { data, error } = await db().from("sites").select("id, name, active").eq("active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Site[]).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 이 계정이 열 수 있는 현장: 관리자는 전체, 담당자는 배정된 현장 */
export async function accessibleSites(p: Profile): Promise<Site[]> {
  return p.role === "admin" ? allSites() : memberSites(p.user_id);
}

/**
 * 지금 작업 중인 현장. 열 수 있는 현장 중 쿠키로 고른 것(없으면 첫 번째).
 * 모든 기록 API는 이걸 거쳐서, 권한 없는 현장 데이터에는 절대 닿지 않는다.
 */
export async function currentSite(req: NextRequest): Promise<{ user: Profile; site: Site; sites: Site[] }> {
  const user = await activeUser(req);
  const sites = await accessibleSites(user);
  if (!sites.length) throw new HttpError(403, "배정된 현장이 없습니다. 관리자에게 현장 배정을 요청하세요.");
  const want = Number(req.cookies.get(SITE_COOKIE)?.value);
  const site = sites.find((s) => s.id === want) ?? sites[0];
  return { user, site, sites };
}
