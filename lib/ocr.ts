import { QuotaError, readPageGemini, type PageRead } from "./gemini";

/** 인식 실패 — 화면에 그대로 보여 줄 문장 */
export class OcrFailed extends Error {}

/** 기록지 읽기 (Gemini). 한도에 걸리면 Gemini 안에서 다른 모델로 넘기고, 그래도 안 되면 이유를 알려 줌 */
export async function readPage(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  try {
    return await readPageGemini(imageBase64, mimeType, companies);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[ocr] Gemini 실패:", msg.slice(0, 300));
    if (e instanceof QuotaError) {
      throw new OcrFailed(e.daily
        ? "Gemini 오늘 사용량 한도를 다 썼습니다. 한국시간 오후 4~5시에 초기화됩니다."
        : `Gemini 사용량 한도에 걸렸습니다. ${e.retryAfter}초 뒤 다시 시도하세요.`);
    }
    if (/503|UNAVAILABLE|high demand/i.test(msg)) throw new OcrFailed("Gemini 서버가 잠시 혼잡합니다. 잠시 뒤 다시 시도하세요.");
    if (/timeout|timed out|aborted|지연/i.test(msg)) throw new OcrFailed("Gemini 응답이 너무 늦어 중단했습니다. 사진을 다시 올려 주세요.");
    throw new OcrFailed(`사진을 읽지 못했습니다. (${msg.slice(0, 150)})`);
  }
}
