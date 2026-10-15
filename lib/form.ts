/**
 * '폐기물 반출 현황' 기록지 규칙
 * - 손글씨에서 그대로 읽은 값(raw)을 엑셀에 넣을 값으로 정리한다.
 * - 서버(인식 직후)와 브라우저(수정 시) 양쪽에서 같이 쓴다.
 */

export type Dispatch = {
  seq: number;
  vehicle_no: string;
  company: string;
  out_time: string; // 'H:MM'
};

/** 화면에서 쓰는 행: 확인이 필요한 칸 표시 포함 */
export type EditRow = Dispatch & { check?: Partial<Record<"vehicle_no" | "company" | "out_time", string>> };

export type RawRow = { seq?: number | string; vehicle?: string; company?: string; time?: string };

export type Company = { id?: number; name: string; sort_order: number; separate: boolean; active?: boolean };

// ── 업체: 같은 위 칸을 뜻하는 표시 ────────────────────────────
// 기록지에서는 '〃'를 흘려 써서 11, ll, 7, ㄱ, " 처럼 보인다.
const DITTO = /^(〃|"|''|“|”|''|11|ll|\|\||1\/|7|ㄱ|ク|-|ㅡ|상동|동|=)$/;
export const isDitto = (s: string) => DITTO.test(s.replace(/\s/g, ""));

// ── 한글 자모 분해 → 편집 거리로 가장 가까운 업체 찾기 ─────────
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
function jamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + (c % 28 ? JONG[c % 28] : "");
  }
  return out;
}
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** 읽은 업체명을 등록된 업체 중 가장 가까운 이름으로. 확신이 없으면 note를 붙인다 */
export function matchCompany(raw: string, names: string[]): { name: string; note?: string } {
  const s = raw.replace(/\s|\(\?\)|\?/g, "");
  if (!s) return { name: "", note: "업체 비어 있음" };
  if (names.includes(s)) return raw.includes("?") ? { name: s, note: `'${raw}'로 읽힘` } : { name: s };
  const js = jamo(s);
  let best = "", bestD = Infinity, ties = 0;
  for (const n of names) {
    const d = editDistance(js, jamo(n));
    if (d < bestD) { bestD = d; best = n; ties = 0; }
    else if (d === bestD) ties++;
  }
  // 자모 1개 차이(한발→한밭)는 흘림체 오인으로 보고 조용히 고침,
  // 2개 차이이거나 후보가 여럿이면 고치되 확인 표시
  if (best && bestD === 1 && ties === 0) return { name: best };
  if (best && bestD <= 2) {
    return { name: best, note: `'${s}' → '${best}' 자동 교정${ties ? " (후보 여러 개)" : ""}` };
  }
  return { name: s, note: "등록되지 않은 업체" };
}

// ── 시간: '06:08', '11', ':48', '0805' → 'H:MM' (앞 행의 시를 이어받음) ──
export function parseTime(raw: string, prev: { h: number; m: number } | null):
  { value: string; h: number; m: number; note?: string } | null {
  const s = raw.replace(/[^\d:;.]/g, "").replace(/[;.]/g, ":");
  if (!s.replace(/:/g, "")) return null;
  let h: number | null = null, m: number;
  let note: string | undefined;

  if (/^\d{1,2}:\d{1,2}$/.test(s)) {
    const [a, b] = s.split(":").map(Number); h = a; m = b;
  } else if (/^:\d{1,2}$/.test(s)) {
    m = Number(s.slice(1));
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2)); m = Number(s.slice(-2));
  } else if (/^\d{1,2}$/.test(s)) {
    m = Number(s);
  } else {
    return null;
  }

  if (h === null) {
    // 분만 적힌 경우 → 앞 행의 시. 분이 줄었으면 시가 넘어간 것
    if (!prev) return { value: `?:${String(m).padStart(2, "0")}`, h: 0, m, note: "시(時)를 알 수 없음" };
    h = prev.h;
    if (m < prev.m) { h += 1; note = `분만 적혀 있어 ${h}시로 계산`; }
  }
  if (m > 59 || h > 23) return { value: raw, h: prev?.h ?? 0, m: prev?.m ?? 0, note: "시간 형식 오류" };
  if (prev && h * 60 + m < prev.h * 60 + prev.m) note = note ?? "앞 행보다 이른 시간";
  return { value: `${h}:${String(m).padStart(2, "0")}`, h, m, note };
}

/** Gemini가 읽은 원본 행들 → 정리된 행 (업체 〃 처리, 시간 이어받기, 업체명 교정) */
export function normalizeRows(raw: RawRow[], companyNames: string[], startSeq = 1, prevState?: {
  company?: string; time?: { h: number; m: number } | null;
}): EditRow[] {
  const out: EditRow[] = [];
  let lastCompany = prevState?.company ?? "";
  let lastTime = prevState?.time ?? null;

  // 번호 방식은 장 단위로 정함: 121 이상 번호가 적힌 장이면 그대로, 1~120짜리 장이면 앞 장 뒤로 밀어 붙임
  const printedNums = raw.map((r) => Number(r.seq)).filter((n) => Number.isInteger(n) && n > 0);
  const continuesNumbering = printedNums.some((n) => n > 120) && Math.min(...printedNums) >= startSeq;
  const offset = startSeq === 1 || continuesNumbering ? 0 : startSeq - 1;

  raw.forEach((r, i) => {
    const check: EditRow["check"] = {};
    // 차량번호: 숫자 4자리
    const vRaw = String(r.vehicle ?? "").trim();
    const vehicle = vRaw.replace(/[^\d]/g, "");
    if (vehicle.length !== 4 || vRaw.includes("?")) check.vehicle_no = `'${vRaw}'로 읽힘 — 4자리 확인`;

    // 업체
    const cRaw = String(r.company ?? "").trim();
    let company: string;
    if (isDitto(cRaw)) {
      company = lastCompany;
      if (!company) check.company = "첫 행인데 〃 표시";
    } else {
      const m = matchCompany(cRaw, companyNames);
      company = m.name;
      if (m.note) check.company = m.note;
    }
    if (company) lastCompany = company;

    // 시간
    const t = parseTime(String(r.time ?? ""), lastTime);
    let out_time = "";
    if (!t) check.out_time = "시간 비어 있음";
    else {
      out_time = t.value;
      if (t.note) check.out_time = t.note;
      if (!t.note || !t.note.includes("오류")) lastTime = { h: t.h, m: t.m };
    }

    // 기록지의 번호를 기준으로 연번을 매김 (빈 줄을 건너뛰어도 번호가 밀리지 않게)
    //  - 장마다 1~120이면: 앞 장 마지막 번호 뒤로 이어 붙임 (둘째 장 1번 → 121번)
    //  - 둘째 장에 121~ 번호가 적혀 있으면: 그 번호를 그대로 사용
    const printed = Number(r.seq);
    const seq = !Number.isInteger(printed) || printed <= 0 ? startSeq + i
      : offset === 0 ? printed
      : offset + ((printed - 1) % 120) + 1; // 장 안 위치(1~120) 기준이라 121~ 번호가 섞여 와도 겹치지 않음
    out.push({ seq, vehicle_no: vehicle || vRaw, company, out_time, check });
  });
  return out;
}

/** 날짜 'YYYY-MM-DD' → '2026년 10월 14일 수요일' */
export function koreanDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${y}년 ${m}월 ${day}일 ${w}요일`;
}

/** 기록지의 '10/15' → 'YYYY-MM-DD' (연도는 기준 날짜의 연도) */
export function parseFormDate(text: string | undefined, baseYear: number): string | null {
  const m = String(text ?? "").match(/(\d{1,2})\s*[\/.\-월]\s*(\d{1,2})/);
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${baseYear}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const timeToMinutes = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
