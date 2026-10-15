export const AUTH_COOKIE = "hw_auth";

/** 붙여넣기 때 섞인 앞뒤 공백·줄바꿈, 한글 조합형 차이를 없앤 비밀번호 */
export const cleanPassword = (s: string | undefined | null) => String(s ?? "").normalize("NFC").trim();

/** 비밀번호를 그대로 쿠키에 넣지 않도록 SHA-256 해시를 토큰으로 사용 */
export async function authToken(): Promise<string> {
  const pw = cleanPassword(process.env.APP_PASSWORD);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hw:" + pw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
