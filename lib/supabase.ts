import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** 서버 전용 클라이언트 (service role 키 사용 — 절대 브라우저로 보내지 않음) */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
