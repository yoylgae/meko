import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return { url, key };
}

/** 서버 전용 클라이언트 (service role 키 사용 — 절대 브라우저로 보내지 않음) */
export function db(): SupabaseClient {
  if (!client) {
    const { url, key } = env();
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/**
 * 이메일·비밀번호 확인 전용. 로그인에 성공하면 클라이언트가 그 사용자 권한으로 바뀌므로
 * 공용 db() 클라이언트와 섞이지 않게 매번 새로 만든다.
 */
export async function checkPassword(email: string, password: string): Promise<string | null> {
  const { url, key } = env();
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  return data.user.id;
}
