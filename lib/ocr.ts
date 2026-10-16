import { QuotaError, readPageGemini, type PageRead } from "./gemini";
import { claudeAvailable, readPageClaude } from "./claude";

export type Engine = "gemini" | "claude";

/** 두 엔진 모두 실패 — 화면에 그대로 보여 줄 문장 */
export class OcrFailed extends Error {}

const geminiReason = (e: unknown) =>
  e instanceof QuotaError
    ? (e.daily ? "Gemini 오늘 무료 사용량 소진" : "Gemini 무료 사용량 한도(분당)")
    : /503|UNAVAILABLE|high demand/i.test(String((e as Error)?.message)) ? "Gemini 서버 혼잡"
    : "Gemini 오류";

/**
 * 기록지 읽기: Gemini 한 번(모델별 한도 넘김 포함) → 실패하면 Claude 한 번.
 * 둘 다 실패하면 바로 이유를 알려 줌 (자동 재시도·대기 없음).
 */
export async function readPage(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead & { engine: Engine }> {
  try {
    return { ...(await readPageGemini(imageBase64, mimeType, companies)), engine: "gemini" };
  } catch (geminiErr) {
    const gReason = geminiReason(geminiErr);
    console.warn("[ocr] Gemini 실패 → Claude로 전환:", (geminiErr as Error)?.message?.slice(0, 200));
    if (!claudeAvailable()) {
      throw new OcrFailed(`${gReason}로 읽지 못했습니다. 잠시 뒤 다시 시도하세요. (Claude 대체 인식은 API 키가 없어 꺼져 있음)`);
    }
    try {
      return { ...(await readPageClaude(imageBase64, mimeType, companies)), engine: "claude" };
    } catch (claudeErr) {
      console.error("[ocr] Claude도 실패:", (claudeErr as Error)?.message);
      throw new OcrFailed(`${gReason}로 Claude에 넘겼지만 Claude도 실패했습니다. ${(claudeErr as Error).message}`);
    }
  }
}
