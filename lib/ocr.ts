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
    if (/서버 응답 없음|503|504|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|timeout|timed out|aborted/i.test(msg)) {
      const models = msg.match(/시도한 모델: ([^)]+)\)/)?.[1];
      throw new OcrFailed(`지금 Gemini 서버가 응답하지 않습니다${models ? ` (${models} 모두 시도함)` : ""}. Google 쪽 일시적인 문제라 몇 분 뒤 다시 올려 주세요.`);
    }
    throw new OcrFailed(`사진을 읽지 못했습니다. (${msg.slice(0, 150)})`);
  }
}
