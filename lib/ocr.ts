import { createHmac } from "node:crypto";
import { db } from "./supabase";
import type { RawRow } from "./form";

export type PageRead = { date_text: string; total_text: string; rows: RawRow[] };

/** 인식 실패 — 화면에 그대로 보여 줄 문장 */
export class OcrFailed extends Error {}

/** 사이트 안 Python 함수(/api/read)를 부를 때 붙이는 비밀 머리글 */
function internalKey() {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHmac("sha256", "meko-ocr:" + secret).update("read").digest("hex");
}

/** 이 현장의 지난 기록: 예전에 온 차량번호, 차량별로 온 업체 횟수 */
async function siteHistory(siteId: number) {
  const vehCo: Record<string, Record<string, number>> = {};
  for (let off = 0; off < 200_000; off += 1000) {
    const { data } = await db().from("dispatches").select("vehicle_no, company")
      .eq("site_id", siteId).range(off, off + 999);
    for (const r of data ?? []) {
      const v = String(r.vehicle_no ?? ""), c = String(r.company ?? "");
      if (!/^\d{4}$/.test(v) || !c) continue;
      (vehCo[v] ??= {})[c] = (vehCo[v][c] ?? 0) + 1;
    }
    if (!data || data.length < 1000) break;
  }
  return vehCo;
}

/**
 * 기록지 읽기 — 이 사이트 전용으로 학습시킨 인식기(Python, /api/read)
 * after: 앞 장 마지막 출차시각(분). 둘째 장의 시간이 앞 장에서 이어지게 함
 */
export async function readPage(origin: string, image: Buffer, siteId: number, companies: string[], after: number | null): Promise<PageRead> {
  const veh_co = await siteHistory(siteId);
  let r: Response;
  try {
    r = await fetch(`${origin}/api/read`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-meko-key": internalKey() },
      body: JSON.stringify({ image: image.toString("base64"), known: Object.keys(veh_co), veh_co, companies, after }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (e) {
    console.error("[ocr] 인식기 호출 실패:", e);
    throw new OcrFailed("인식기가 응답하지 않습니다. 잠시 뒤 다시 올려 주세요.");
  }
  const j = await r.json().catch(() => ({})) as { rows?: (RawRow & { check?: Record<string, string> })[]; error?: string };
  if (!r.ok) {
    console.error("[ocr] 인식기 오류:", r.status, j.error);
    throw new OcrFailed(`사진을 읽지 못했습니다. (${j.error ?? r.status})`);
  }
  return { date_text: "", total_text: "", rows: j.rows ?? [] };
}
