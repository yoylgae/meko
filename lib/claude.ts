import { keepRange, mergeHalves, ocrPrompt, type PageRead } from "./gemini";

/**
 * Claude(기본 Sonnet)로 기록지 읽기 — Gemini가 실패했을 때 대신 사용.
 * 같은 안내문을 쓰고, '도구 호출'로 답을 강제해서 항상 정해진 JSON 모양으로 받는다.
 */
const TOOL = {
  name: "record_sheet",
  description: "기록지에서 읽은 값을 기록합니다.",
  input_schema: {
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
        },
      },
    },
    required: ["date_text", "total_text", "rows"],
  },
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
      temperature: 0,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: image } },
          { type: "text", text: ocrPrompt(companies, from, to) + "\n\n결과는 record_sheet 도구로 기록하세요." },
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
  const block = (j.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!block?.input) throw new Error("Claude 응답에서 결과를 찾지 못했습니다.");
  return keepRange(block.input as PageRead, from, to);
}

export async function readPageClaude(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  const [a, b] = await Promise.all([
    readRange(imageBase64, mimeType, companies, 1, 60),
    readRange(imageBase64, mimeType, companies, 61, 120),
  ]);
  return mergeHalves(a, b);
}
