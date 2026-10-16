import { QuotaError, readPageGemini, type PageRead } from "./gemini";
import { claudeAvailable, readPageClaude } from "./claude";

export type Engine = "gemini" | "claude";

/**
 * 기록지 읽기: Gemini 먼저(모델별 한도 넘김 포함), 어떤 이유로든 실패하면 Claude로 다시 읽음.
 * Claude 키가 없거나 Claude도 실패하면 원래 Gemini 오류를 그대로 올림(화면의 자동 재시도용).
 */
export async function readPage(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead & { engine: Engine }> {
  try {
    return { ...(await readPageGemini(imageBase64, mimeType, companies)), engine: "gemini" };
  } catch (geminiErr) {
    if (!claudeAvailable()) throw geminiErr;
    console.warn("[ocr] Gemini 실패 → Claude로 전환:", (geminiErr as Error)?.message?.slice(0, 200));
    try {
      return { ...(await readPageClaude(imageBase64, mimeType, companies)), engine: "claude" };
    } catch (claudeErr) {
      console.error("[ocr] Claude도 실패:", (claudeErr as Error)?.message);
      if (geminiErr instanceof QuotaError) throw geminiErr;
      throw new Error(`Gemini와 Claude 모두 읽지 못했습니다. (${(claudeErr as Error).message})`);
    }
  }
}
