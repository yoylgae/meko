import { GoogleGenAI, MediaResolution, Type } from "@google/genai";
import type { RawRow } from "./form";

export type PageRead = { date_text: string; total_text: string; rows: RawRow[] };

export function ocrPrompt(companies: string[], from: number, to: number) {
  return `이 사진은 손으로 쓴 '폐기물 반출 현황' 기록지입니다.

[양식]
- 오른쪽 위에 '월일'(예: 10/15)과 '총댓수' 칸이 있습니다.
- 표는 왼쪽에서 오른쪽으로 6묶음이고, 각 묶음은 [번호 | 차량번호 | 업체 | 출차시간] 4칸 × 20줄입니다.
  1묶음 = 번호 1~20, 2묶음 = 21~40, 3묶음 = 41~60, 4묶음 = 61~80, 5묶음 = 81~100, 6묶음 = 101~120.
- 번호는 인쇄된 숫자입니다. 차량번호·업체·출차시간은 손글씨입니다.
- 하루에 120대가 넘으면 두 번째 장을 씁니다. 두 번째 장은 번호가 121~240으로 인쇄되어 있거나,
  1~120 위에 121~240을 손으로 고쳐 써 두었을 수 있습니다. 그 경우 seq에는 121~240 번호를 적으세요.

[이번에 읽을 범위]
${from === 1 ? "왼쪽 1~3묶음" : "오른쪽 4~6묶음"}(번호 ${from}~${to}, 두 번째 장이라면 ${from + 120}~${to + 120}) 중
차량번호가 적힌 줄만 번호 순서대로 읽으세요. 빈 줄은 건너뜁니다.

[각 칸을 적는 법 — 해석하지 말고 보이는 그대로]
- seq: 인쇄된 번호(숫자).
- vehicle: 차량번호 숫자 4자리. 애매한 숫자는 가장 그럴듯한 숫자를 쓰고 끝에 '?'를 붙이세요.
- company: 업체명. 위 칸과 같다는 표시(〃, 11처럼 보이는 두 줄, 7·ㄱ처럼 보이는 꺾쇠)는 반드시 "〃" 로 적으세요.
  업체는 보통 다음 중 하나입니다: ${companies.join(", ")}.
  흘려 쓴 글씨는 이 목록에서 가장 가까운 이름으로 적되, 목록에 없는 게 확실하면 보이는 대로 적으세요.
- time: 출차시간을 적힌 그대로. '06:08'처럼 시:분이 다 있으면 그대로, 분만 적혀 있으면 '11'처럼 분 숫자만,
  ':48'처럼 콜론과 분만 있으면 ':48'. 시를 추측해서 채우지 마세요.

[표 밖]
- date_text: '월일' 칸에 적힌 값 (예: "10/15"). 없으면 "".
- total_text: '총댓수' 칸에 적힌 값. 없으면 "".`;
}

const schema = {
  type: Type.OBJECT,
  properties: {
    date_text: { type: Type.STRING },
    total_text: { type: Type.STRING },
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          seq: { type: Type.INTEGER },
          vehicle: { type: Type.STRING },
          company: { type: Type.STRING },
          time: { type: Type.STRING },
        },
        required: ["seq", "vehicle", "company", "time"],
        propertyOrdering: ["seq", "vehicle", "company", "time"],
      },
    },
  },
  required: ["date_text", "total_text", "rows"],
  propertyOrdering: ["date_text", "total_text", "rows"],
};

async function readRange(ai: GoogleGenAI, model: string, image: string, mimeType: string,
  companies: string[], from: number, to: number): Promise<PageRead> {
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: image } }, { text: ocrPrompt(companies, from, to) }] }],
    config: {
      temperature: 0,
      maxOutputTokens: 32768, // 생각(thinking) 토큰까지 포함해도 표 60줄이 잘리지 않게
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  const text = res.text ?? "";
  const cand = res.candidates?.[0];
  let parsed: PageRead | null = null;
  try { parsed = JSON.parse(text) as PageRead; } catch { /* 아래에서 처리 */ }
  const kept = parsed ? keepRange(parsed, from, to) : null;

  // 진단용 기록: 어떤 모델이 무엇을 얼마나 돌려줬는지 (Vercel 로그에서 확인)
  console.log("[gemini]", JSON.stringify({
    model, range: `${from}-${to}`,
    finish: cand?.finishReason, block: res.promptFeedback?.blockReason,
    usage: res.usageMetadata ? {
      in: res.usageMetadata.promptTokenCount, out: res.usageMetadata.candidatesTokenCount,
      think: res.usageMetadata.thoughtsTokenCount, total: res.usageMetadata.totalTokenCount,
    } : null,
    textLen: text.length, rawRows: parsed?.rows?.length ?? null, keptRows: kept?.rows.length ?? null,
    date: parsed?.date_text, sample: parsed?.rows?.slice(0, 2),
  }));

  if (!kept) {
    if (cand?.finishReason === "MAX_TOKENS") throw new Error("Gemini 응답이 길이 제한에 걸려 잘렸습니다.");
    throw new Error(`Gemini 응답을 해석하지 못했습니다 (${cand?.finishReason ?? "?"}): ` + text.slice(0, 200));
  }
  return kept;
}

/** 사용량 한도(429)에 걸렸을 때. retryAfter = 다시 시도해도 되는 초 */
export class QuotaError extends Error {
  constructor(public retryAfter: number, public daily: boolean) {
    super(daily ? "Gemini 오늘 사용량 한도를 다 썼습니다." : "Gemini 분당 사용량 한도에 걸렸습니다.");
  }
}

function quotaInfo(e: unknown): { retryAfter: number; daily: boolean } | null {
  const msg = String((e as { message?: string })?.message ?? e);
  const status = (e as { status?: number })?.status;
  if (status !== 429 && !/RESOURCE_EXHAUSTED|"code":\s*429|quota/i.test(msg)) return null;
  const m = msg.match(/retry in ([\d.]+)s/i) ?? msg.match(/"retryDelay":\s*"(\d+)s"/);
  const daily = /PerDay|per day|RPD/i.test(msg);
  return { retryAfter: m ? Math.ceil(Number(m[1])) : 30, daily };
}

/**
 * 쓸 모델 순서. 한도는 모델마다 따로라서, 앞 모델이 한도에 걸리면 다음 모델로 넘어간다.
 * GEMINI_MODEL(기본 최신 Flash) → GEMINI_FALLBACK_MODELS(쉼표 구분)
 */
function modelChain(): string[] {
  const main = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([main, ...fallbacks])];
}

/**
 * 기록지 한 장 읽기.
 * 120칸을 한 번에 읽으면 뒤쪽 정확도가 떨어져서 1~60 / 61~120 두 번으로 나눠 동시에 요청한다.
 * 한도에 걸리면 다음 모델로, 모든 모델이 막히면 QuotaError.
 */
export async function readPageGemini(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 없습니다.");
  // 한 요청이 2분을 넘기면 끊음 (서버 제한 5분 안에서 다음 모델까지 시도할 여유)
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });
  const started = Date.now();

  let lastQuota: { retryAfter: number; daily: boolean } | null = null;
  for (const model of modelChain()) {
    // 이미 2분 넘게 썼으면 다음 모델은 시도하지 않음 (서버 제한 5분)
    if (Date.now() - started > 120_000) throw new Error("Gemini 응답 지연(시간 초과)");
    try {
      return await readWithModel(ai, model, imageBase64, mimeType, companies);
    } catch (e) {
      const q = quotaInfo(e);
      const missing = /not found|is not supported|404/i.test(String((e as Error)?.message));
      if (!q && !missing) throw e;           // 한도·없는 모델이 아닌 오류는 그대로
      if (q) lastQuota = !lastQuota || q.retryAfter < lastQuota.retryAfter ? q : lastQuota;
      console.warn(`[gemini] ${model} 건너뜀: ${q ? "사용량 한도" : "모델 없음"}`);
    }
  }
  throw new QuotaError(lastQuota?.retryAfter ?? 30, lastQuota?.daily ?? false);
}

async function readWithModel(ai: GoogleGenAI, model: string, imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  const [a, b] = await Promise.all([
    readRange(ai, model, imageBase64, mimeType, companies, 1, 60),
    readRange(ai, model, imageBase64, mimeType, companies, 61, 120),
  ]);
  return mergeHalves(a, b);
}

/** 장 안에서의 위치(1~120)로 범위를 확인 — 두 번째 장의 121~240 번호도 받아들임 */
export function keepRange(p: PageRead, from: number, to: number): PageRead {
  const pos = (s: number) => ((s - 1) % 120) + 1;
  return {
    date_text: String(p.date_text ?? ""),
    total_text: String(p.total_text ?? ""),
    rows: (p.rows ?? []).filter((r) => {
      const s = Number(r.seq);
      return Number.isInteger(s) && s > 0 && pos(s) >= from && pos(s) <= to;
    }),
  };
}

/** 왼쪽 절반(1~60)·오른쪽 절반(61~120) 결과 합치기 */
export function mergeHalves(a: PageRead, b: PageRead): PageRead {
  const bySeq = new Map<number, RawRow>();
  [...a.rows, ...b.rows].forEach((r) => bySeq.set(Number(r.seq), r));
  return {
    date_text: a.date_text || b.date_text,
    total_text: a.total_text || b.total_text,
    rows: [...bySeq.entries()].sort((x, y) => x[0] - y[0]).map(([, r]) => r),
  };
}
