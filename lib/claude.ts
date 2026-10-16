import { keepRange, mergeHalves, ocrPrompt, type PageRead } from "./gemini";

/**
 * Claude(기본 Sonnet)로 기록지 읽기 — Gemini가 실패했을 때 대신 사용.
 * 같은 안내문을 쓰고, 구조화 출력(output_config JSON 스키마)으로 항상 정해진 모양의 JSON을 받는다.
 * (최신 모델은 tool_choice로 도구 호출을 강제하는 방식을 지원하지 않음)
 */
const SCHEMA = {
  type: "object",
  properties: {
    date_text: { type: "string", description: "'월일' 칸 값, 없으면 빈 문자열" },
    total_text: { type: "string", description: "'총댓수' 칸 값, 없으면 빈 문자열" },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          seq: { type: "integer" },
          vehicle: { type: "string" },
          company: { type: "string" },
          time: { type: "string" },
        },
        required: ["seq", "vehicle", "company", "time"],
        additionalProperties: false,
      },
    },
  },
  required: ["date_text", "total_text", "rows"],
  additionalProperties: false,
};

/** 붙여넣을 때 섞인 공백·줄바꿈·따옴표 제거 */
const apiKey = () => String(process.env.ANTHROPIC_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
export const claudeAvailable = () => !!apiKey();

async function readRange(image: string, mimeType: string, companies: string[], from: number, to: number): Promise<PageRead> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: image } },
          { type: "text", text: ocrPrompt(companies, from, to) },
        ],
      }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message ?? `HTTP ${res.status}`;
    const hint =
      res.status === 401 ? "Claude API 키가 올바르지 않습니다. Vercel의 ANTHROPIC_API_KEY를 다시 넣어 주세요." :
      /credit|billing|balance/i.test(msg) ? "Claude API 크레딧이 부족합니다. platform.claude.com에서 충전하세요." :
      res.status === 429 ? "Claude 사용량 한도에 걸렸습니다." :
      res.status === 529 || res.status >= 500 ? "Claude 서버가 잠시 바쁩니다." : "";
    throw new Error(`${hint ? hint + " " : ""}(Claude: ${msg})`);
  }
  if (j.stop_reason === "max_tokens") throw new Error("Claude 응답이 너무 길어 잘렸습니다.");
  const text = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  try {
    return keepRange(JSON.parse(text) as PageRead, from, to);
  } catch {
    throw new Error("Claude 응답을 해석하지 못했습니다: " + text.slice(0, 200));
  }
}

export async function readPageClaude(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  const [a, b] = await Promise.all([
    readRange(imageBase64, mimeType, companies, 1, 60),
    readRange(imageBase64, mimeType, companies, 61, 120),
  ]);
  return mergeHalves(a, b);
}
