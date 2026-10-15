import { GoogleGenAI, MediaResolution, Type } from "@google/genai";
import type { RawRow } from "./form";

export type PageRead = { date_text: string; total_text: string; rows: RawRow[] };

function prompt(companies: string[], from: number, to: number) {
  return `이 사진은 손으로 쓴 '폐기물 반출 현황' 기록지입니다.

[양식]
- 오른쪽 위에 '월일'(예: 10/15)과 '총댓수' 칸이 있습니다.
- 표는 왼쪽에서 오른쪽으로 6묶음이고, 각 묶음은 [번호 | 차량번호 | 업체 | 출차시간] 4칸 × 20줄입니다.
  1묶음 = 번호 1~20, 2묶음 = 21~40, 3묶음 = 41~60, 4묶음 = 61~80, 5묶음 = 81~100, 6묶음 = 101~120.
- 번호는 인쇄된 숫자입니다. 차량번호·업체·출차시간은 손글씨입니다.

[이번에 읽을 범위]
번호 ${from}~${to} 중 차량번호가 적힌 줄만 번호 순서대로 읽으세요. 빈 줄은 건너뜁니다.

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
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: image } }, { text: prompt(companies, from, to) }] }],
    config: {
      temperature: 0,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  const text = res.text ?? "";
  try {
    const p = JSON.parse(text) as PageRead;
    p.rows = (p.rows ?? []).filter((r) => Number(r.seq) >= from && Number(r.seq) <= to);
    return p;
  } catch {
    throw new Error("Gemini 응답을 해석하지 못했습니다: " + text.slice(0, 200));
  }
}

/**
 * 기록지 한 장 읽기.
 * 120칸을 한 번에 읽으면 뒤쪽 정확도가 떨어져서 1~60 / 61~120 두 번으로 나눠 동시에 요청한다.
 */
export async function readPage(imageBase64: string, mimeType: string, companies: string[]): Promise<PageRead> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 없습니다.");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const ai = new GoogleGenAI({ apiKey });

  const [a, b] = await Promise.all([
    readRange(ai, model, imageBase64, mimeType, companies, 1, 60),
    readRange(ai, model, imageBase64, mimeType, companies, 61, 120),
  ]);
  const bySeq = new Map<number, RawRow>();
  [...a.rows, ...b.rows].forEach((r) => bySeq.set(Number(r.seq), r));
  return {
    date_text: a.date_text || b.date_text,
    total_text: a.total_text || b.total_text,
    rows: [...bySeq.entries()].sort((x, y) => x[0] - y[0]).map(([, r]) => r),
  };
}
