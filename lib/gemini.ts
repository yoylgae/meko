import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from "@google/genai";
import sharp from "sharp";
import type { RawRow } from "./form";

export type PageRead = { date_text: string; total_text: string; rows: RawRow[] };

export function ocrPrompt(companies: string[], from: number, to: number, frequent: string[] = []) {
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
${companyRule(companies, frequent)}
- time: 출차시간을 적힌 그대로. '06:08'처럼 시:분이 다 있으면 그대로, 분만 적혀 있으면 '11'처럼 분 숫자만,
  ':48'처럼 콜론과 분만 있으면 ':48'. 시를 추측해서 채우지 마세요.

[표 밖]
- date_text: '월일' 칸에 적힌 값 (예: "10/15"). 없으면 "".
- total_text: '총댓수' 칸에 적힌 값. 없으면 "".`;
}

/**
 * 결과 모양. 업체는 등록된 업체 이름이나 "〃"만 고를 수 있게 enum으로 제한
 * (기록지에는 등록된 업체만 적히므로, 없는 이름을 지어내지 않게)
 */
export const DITTO_MARK = "〃";
function schemaFor(companies: string[]) {
  const company = companies.length
    ? { type: Type.STRING, format: "enum", enum: [...new Set([...companies, DITTO_MARK])] }
    : { type: Type.STRING };
  return {
    type: Type.OBJECT,
    properties: {
      date_text: { type: Type.STRING },
      total_text: { type: Type.STRING },
      rows: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { seq: { type: Type.INTEGER }, vehicle: { type: Type.STRING }, company, time: { type: Type.STRING } },
          required: ["seq", "vehicle", "company", "time"],
          propertyOrdering: ["seq", "vehicle", "company", "time"],
        },
      },
    },
    required: ["date_text", "total_text", "rows"],
    propertyOrdering: ["date_text", "total_text", "rows"],
  };
}

const companyRule = (companies: string[], frequent: string[] = []) => {
  const fq = frequent.filter((n) => companies.includes(n));
  const others = companies.filter((n) => !fq.includes(n));
  const list = fq.length
    ? `\n  · 이 현장에 자주 오는 업체(대부분 이 중 하나): ${fq.join(", ")}` + (others.length ? `\n  · 가끔 오는 업체: ${others.join(", ")}` : "")
    : ` ${companies.join(", ")}`;
  return `- company: 업체명. 위 칸과 같다는 표시(〃, 11처럼 보이는 두 줄, 7·ㄱ처럼 보이는 꺾쇠)는 반드시 "〃" 로 적으세요.
  업체는 반드시 다음 목록 중 하나입니다(이 기록지에는 목록에 없는 업체가 적히지 않습니다):${list}
  흘려 쓴 글씨는 글자 모양이 가장 비슷한 이름을 고르되, 애매하면 자주 오는 업체를 우선하세요.`;
};

type Level = "low" | "medium" | "high";
function level(env: string | undefined, dflt: Level): ThinkingLevel {
  const v = String(env ?? dflt).trim().toLowerCase();
  return v === "high" ? ThinkingLevel.HIGH : v === "medium" ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW;
}

/** Gemini 호출 1번: 사진+안내문 → 스키마대로 JSON. 진단용으로 사용량을 로그에 남김 */
async function callJson<T>(ai: GoogleGenAI, model: string, label: string, image: string, mimeType: string,
  text: string, responseSchema: object, thinking: ThinkingLevel, timeoutMs = 60_000): Promise<T> {
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: image } }, { text }] }],
    config: {
      httpOptions: { timeout: timeoutMs }, // 서버가 멈춰 있으면 오래 기다리지 않고 다른 모델로 넘김
      temperature: 0,
      maxOutputTokens: 32768, // 생각(thinking) 토큰까지 포함해도 결과가 잘리지 않게
      thinkingConfig: { thinkingLevel: thinking },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      responseMimeType: "application/json",
      responseSchema,
    },
  });
  const out = res.text ?? "";
  const cand = res.candidates?.[0];
  let parsed: T | null = null;
  try { parsed = JSON.parse(out) as T; } catch { /* 아래에서 처리 */ }
  const u = res.usageMetadata;
  console.log("[gemini]", JSON.stringify({
    model, label, ms: Date.now() - t0, finish: cand?.finishReason, block: res.promptFeedback?.blockReason,
    usage: u ? { in: u.promptTokenCount, out: u.candidatesTokenCount, think: u.thoughtsTokenCount, total: u.totalTokenCount } : null,
    rows: (parsed as { rows?: unknown[] } | null)?.rows?.length ?? null,
  }));
  if (parsed === null) {
    if (cand?.finishReason === "MAX_TOKENS") throw new Error("Gemini 응답이 길이 제한에 걸려 잘렸습니다.");
    throw new Error(`Gemini 응답을 해석하지 못했습니다 (${cand?.finishReason ?? "?"}): ` + out.slice(0, 200));
  }
  return parsed;
}

/** 사진 전체에서 번호 범위 읽기 (묶음 자르기가 안 될 때 쓰는 예전 방식) */
async function readRange(ai: GoogleGenAI, model: string, image: string, mimeType: string,
  companies: string[], from: number, to: number, frequent: string[] = []): Promise<PageRead> {
  const p = await callJson<PageRead>(ai, model, `whole ${from}-${to}`, image, mimeType,
    ocrPrompt(companies, from, to, frequent), schemaFor(companies), level(process.env.GEMINI_THINKING, "low"), 75_000);
  return keepRange(p, from, to);
}

// ── 묶음 6개로 잘라 읽기 ───────────────────────────────────────────

type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0~1000
type Layout = { date_text: string; total_text: string; rotate: string; blocks: { group: number; box_2d: number[] }[] };

const layoutSchema = {
  type: Type.OBJECT,
  properties: {
    date_text: { type: Type.STRING },
    total_text: { type: Type.STRING },
    rotate: { type: Type.STRING, format: "enum", enum: ["0", "90", "180", "270"] },
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { group: { type: Type.INTEGER }, box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } } },
        required: ["group", "box_2d"],
        propertyOrdering: ["group", "box_2d"],
      },
    },
  },
  required: ["date_text", "total_text", "rotate", "blocks"],
  propertyOrdering: ["date_text", "total_text", "rotate", "blocks"],
};

const LAYOUT_PROMPT = `이 사진은 손으로 쓴 '폐기물 반출 현황' 기록지입니다.
표는 [번호 | 차량번호 | 업체 | 출차시간] 4칸짜리 묶음이 가로로 6개 나란히 있고, 묶음마다 20줄입니다.
각 묶음의 위치를 box_2d = [ymin, xmin, ymax, xmax] (사진 전체를 0~1000으로 본 좌표)로 알려 주세요.
- 상자는 그 묶음의 머리글(번호·차량번호·업체·출차시간)부터 마지막 20번째 줄까지, 4칸 전체를 빠짐없이 덮게 하세요.
- 사진이 기울었거나 돌아가 있어도 실제 보이는 위치 그대로 적으세요.
- group은 번호가 작은 묶음부터 1~6 (1묶음 = 번호 1~20 … 6묶음 = 번호 101~120).
rotate: 사진을 시계 방향으로 몇 도 돌려야 글씨가 똑바로 서는지 (0, 90, 180, 270 중 하나).
  예: 기록지가 왼쪽으로 누워 있어 글씨가 아래에서 위로 읽히면 90.
또 오른쪽 위 '월일' 칸 값을 date_text(예: "10/15"), '총댓수' 칸 값을 total_text로 적으세요. 없으면 "".`;

function blockPrompt(companies: string[], group: number, frequent: string[] = []) {
  const from = (group - 1) * 20 + 1, to = group * 20;
  return `이 사진은 손으로 쓴 '폐기물 반출 현황' 기록지에서 잘라낸 한 묶음입니다.
묶음은 [번호 | 차량번호 | 업체 | 출차시간] 4칸 × 20줄이고, 이 묶음의 번호는 ${from}~${to}입니다
(하루 120대가 넘어 쓴 두 번째 장이면 ${from + 120}~${to + 120}). 가장자리에 옆 묶음이 조금 보이면 무시하세요.

차량번호가 적힌 줄만 위에서부터 번호 순서대로 읽으세요. 빈 줄은 건너뜁니다.

[각 칸을 적는 법 — 해석하지 말고 보이는 그대로]
- seq: 인쇄된 번호(숫자).
- vehicle: 차량번호 숫자 4자리. 애매한 숫자는 가장 그럴듯한 숫자를 쓰고 끝에 '?'를 붙이세요.
${companyRule(companies, frequent)}
- time: 출차시간을 적힌 그대로. '06:08'처럼 시:분이 다 있으면 그대로, 분만 적혀 있으면 '11'처럼 분 숫자만,
  ':48'처럼 콜론과 분만 있으면 ':48'. 시를 추측해서 채우지 마세요.
- date_text, total_text는 빈 문자열로 두세요.`;
}

/**
 * 묶음 위치 6개가 그럴듯하면 1→6 순서로 돌려줌, 아니면 null.
 * 사진이 돌아가 있으면 묶음이 위아래로 쌓여 보이므로 가로·세로 모두 허용하고, 순서는 Gemini가 붙인 group을 따름.
 */
function validBoxes(layout: Layout): Box[] | null {
  const items = (layout.blocks ?? [])
    .filter((b) => Array.isArray(b.box_2d) && b.box_2d.length === 4 && b.box_2d.every((n) => Number.isFinite(n)))
    .map((b) => ({ group: Number(b.group), box: b.box_2d.map((n) => Math.max(0, Math.min(1000, n))) as Box }))
    .filter(({ box: [y0, x0, y1, x1] }) => {
      const long = Math.max(y1 - y0, x1 - x0), short = Math.min(y1 - y0, x1 - x0);
      return long > 150 && short > 30 && long / short > 1.5; // 묶음은 길쭉한 직사각형
    });
  if (items.length !== 6) return null;
  const groups = items.map((i) => i.group).sort((a, b) => a - b);
  if (groups.join() === "1,2,3,4,5,6") return items.sort((a, b) => a.group - b.group).map((i) => i.box);
  // group이 엉망이면 위치로 정렬 (세로로 긴 묶음은 왼→오른쪽, 가로로 긴 묶음은 위→아래)
  const tall = items.every(({ box: [y0, x0, y1, x1] }) => y1 - y0 > x1 - x0);
  return items.sort((a, b) => (tall ? a.box[1] - b.box[1] : a.box[0] - b.box[0])).map((i) => i.box);
}

/** 사진에서 상자 부분을 여유를 두고 잘라, 글씨가 바로 서게 돌린 뒤 JPEG base64로 (작으면 키움) */
async function crop(buf: Buffer, box: Box, rotate: number): Promise<string> {
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  const [y0, x0, y1, x1] = box;
  const padX = (x1 - x0) * 0.06 + 8, padY = (y1 - y0) * 0.06 + 8;
  const left = Math.max(0, Math.floor(((x0 - padX) / 1000) * width));
  const top = Math.max(0, Math.floor(((y0 - padY) / 1000) * height));
  const right = Math.min(width, Math.ceil(((x1 + padX) / 1000) * width));
  const bottom = Math.min(height, Math.ceil(((y1 + padY) / 1000) * height));
  const piece = await sharp(buf)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .rotate([90, 180, 270].includes(rotate) ? rotate : 0)
    .toBuffer();
  const meta = await sharp(piece).metadata();
  let out = sharp(piece);
  if ((meta.height ?? 0) < 1600) out = out.resize({ height: 1600 });
  return (await out.jpeg({ quality: 92 }).toBuffer()).toString("base64");
}

/**
 * 묶음 6개 방식: 위치 찾기(1번) → 6조각 동시에 읽기.
 * 위치를 못 찾으면 null(예전 방식으로). 한 조각이 두 번 실패하면 그 번호 범위만 사진 전체에서 읽음.
 */
async function readByBlocks(ai: GoogleGenAI, model: string, imageBase64: string, mimeType: string,
  companies: string[], frequent: string[] = []): Promise<PageRead | null> {
  let layout: Layout;
  try {
    // 평소 5초 안팎 걸리는 가벼운 요청 — 25초 넘게 답이 없으면 이 모델은 지금 막힌 것
    layout = await callJson<Layout>(ai, model, "layout", imageBase64, mimeType, LAYOUT_PROMPT, layoutSchema, ThinkingLevel.LOW, 25_000);
  } catch (e) {
    if (shouldSwitch(e) || isAccessDenied(e)) throw e; // 한도·서버 문제면 다음 모델로, 접근 거부면 중단
    console.warn("[gemini] 묶음 위치 찾기 실패 → 예전 방식:", String((e as Error)?.message).slice(0, 150));
    return null;
  }
  const boxes = validBoxes(layout);
  console.log("[gemini] 묶음 위치", JSON.stringify({ rotate: layout.rotate, ok: !!boxes }));
  if (!boxes) {
    console.warn("[gemini] 묶음 위치가 이상함 → 예전 방식:", JSON.stringify(layout).slice(0, 400));
    return null;
  }

  const buf = Buffer.from(imageBase64, "base64");
  const thinking = level(process.env.GEMINI_BLOCK_THINKING, "medium");
  const readGroup = async (g: number): Promise<RawRow[]> => {
    const from = (g - 1) * 20 + 1, to = g * 20;
    const piece = await crop(buf, boxes[g - 1], Number(layout.rotate) || 0);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const p = await callJson<PageRead>(ai, model, `block${g}`, piece, "image/jpeg", blockPrompt(companies, g, frequent), schemaFor(companies), thinking);
        return keepRange(p, from, to).rows;
      } catch (e) {
        if (shouldSwitch(e) || isAccessDenied(e)) throw e;
        console.warn(`[gemini] block${g} 실패(${attempt}):`, String((e as Error)?.message).slice(0, 150));
      }
    }
    return (await readRange(ai, model, imageBase64, mimeType, companies, from, to, frequent)).rows; // 마지막 수단
  };
  const groups = await Promise.all([1, 2, 3, 4, 5, 6].map(readGroup));
  return mergeHalves(
    { date_text: String(layout.date_text ?? ""), total_text: String(layout.total_text ?? ""), rows: groups.flat() },
    { date_text: "", total_text: "", rows: [] },
  );
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

/** Gemini 서버 쪽 문제(혼잡·시간 초과·내부 오류) — 같은 모델로 다시 해 봐야 소용없을 때가 많음 */
function isServerTrouble(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  const status = Number((e as { status?: number })?.status);
  return status >= 500 || /UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|overloaded|high demand|"code":\s*50\d|aborted|timed? ?out/i.test(msg);
}
const isMissingModel = (e: unknown) => /not found|is not supported|404/i.test(String((e as Error)?.message));
/** 키·프로젝트가 막힌 경우 — 어떤 모델로 몇 번을 다시 해도 안 되므로 바로 멈춤 */
const isAccessDenied = (e: unknown) =>
  /PERMISSION_DENIED|denied access|API key not valid|API_KEY_INVALID/i.test(String((e as Error)?.message));
/** 다른 모델로 넘겨야 하는 오류인가 (한도·서버 문제·없는 모델) */
const shouldSwitch = (e: unknown) => !!quotaInfo(e) || isServerTrouble(e) || isMissingModel(e);

/**
 * 쓸 모델 순서. 한도·서버 상태는 모델마다 따로라서, 앞 모델이 막히면 다음 모델로 넘어간다.
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
 * 기본: 묶음 6개 위치를 찾아 잘라서 20줄씩 동시에 읽음(작게 잘라 글씨가 크게 보이고, 한 번에 읽는 양이 적어 빠름).
 * 위치를 못 찾으면 예전처럼 1~60 / 61~120 두 번으로 나눠 읽음.
 * 한도·서버 혼잡·시간 초과면 다음 모델로 넘김 (기본: 최신 Flash → 3.6 Flash → 3.5 Flash-Lite).
 */
export async function readPageGemini(imageBase64: string, mimeType: string, companies: string[], frequent: string[] = []): Promise<PageRead> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 없습니다.");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 90_000 } });
  const started = Date.now();

  let lastQuota: { retryAfter: number; daily: boolean } | null = null;
  let lastErr: unknown = null;
  const tried: string[] = [];
  for (const model of modelChain()) {
    // 서버 제한(5분) 안에 끝나도록, 이미 오래 썼으면 다음 모델은 시도하지 않음
    if (Date.now() - started > 170_000) break;
    tried.push(model);
    try {
      const page = await readWithModel(ai, model, imageBase64, mimeType, companies, frequent);
      if (tried.length > 1) console.log(`[gemini] ${model}(으)로 읽음 — 앞 모델: ${tried.slice(0, -1).join(", ")}`);
      return page;
    } catch (e) {
      if (!shouldSwitch(e)) throw e; // 그 밖의 오류는 그대로
      lastErr = e;
      const q = quotaInfo(e);
      if (q) lastQuota = !lastQuota || q.retryAfter < lastQuota.retryAfter ? q : lastQuota;
      console.warn(`[gemini] ${model} 건너뜀: ${q ? "사용량 한도" : isServerTrouble(e) ? "서버 혼잡·응답 없음" : "모델 없음"} — ${String((e as Error)?.message).slice(0, 120)}`);
    }
  }
  if (lastQuota && !isServerTrouble(lastErr)) throw new QuotaError(lastQuota.retryAfter, lastQuota.daily);
  throw new Error(`Gemini 서버 응답 없음 (시도한 모델: ${tried.join(", ")}) ${String((lastErr as Error)?.message ?? "").slice(0, 120)}`);
}

async function readWithModel(ai: GoogleGenAI, model: string, imageBase64: string, mimeType: string, companies: string[], frequent: string[] = []): Promise<PageRead> {
  if (process.env.GEMINI_BLOCKS !== "off") {
    const byBlocks = await readByBlocks(ai, model, imageBase64, mimeType, companies, frequent);
    if (byBlocks) return byBlocks;
  }
  // 예전 방식: 왼쪽·오른쪽 절반을 동시에. 한쪽만 실패하면(한도 제외) 그쪽만 한 번 더 읽음
  const half = (from: number, to: number) => readRange(ai, model, imageBase64, mimeType, companies, from, to, frequent);
  const once = async (from: number, to: number) => {
    try {
      return await half(from, to);
    } catch (e) {
      if (shouldSwitch(e) || isAccessDenied(e)) throw e;
      console.warn(`[gemini] ${model} ${from}-${to} 실패, 한 번 더:`, String((e as Error)?.message).slice(0, 150));
      return half(from, to);
    }
  };
  const [a, b] = await Promise.all([once(1, 60), once(61, 120)]);
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
