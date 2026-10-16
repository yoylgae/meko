/**
 * 로그인 세션 쿠키 (Edge 미들웨어와 서버 양쪽에서 사용)
 * 값: "<userId>.<만료(초)>.<서명>" — 서버 비밀값으로 HMAC 서명해서 위조 불가
 */
export const SESSION_COOKIE = "meko_session";
export const SITE_COOKIE = "meko_site";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmacKey() {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SESSION_SECRET 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  return crypto.subtle.importKey("raw", enc.encode("meko-session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: string) {
  return b64url(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload)));
}

export async function createSessionToken(userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await sign(payload)}`;
}

/** 서명·만료가 맞으면 userId, 아니면 null */
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(uid) || !(Number(exp) > Date.now() / 1000)) return null;
  const expected = await sign(`${uid}.${exp}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? uid : null;
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86400,
};
