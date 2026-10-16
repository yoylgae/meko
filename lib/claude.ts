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

export const claudeAvailable = () => !!process.env.ANTHROPIC_API_KEY;

async function readRange(image: string, mimeType: string, companies: string[], from: number, to: number): Promise<PageRead> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
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
    throw new Error(`Claude 오류: ${msg}`);
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
