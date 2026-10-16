"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  normalizeRows, parseFormDate, parseTime, koreanDate, timeToMinutes,
  type Company, type EditRow, type RawRow,
} from "@/lib/form";

type Field = "vehicle_no" | "company" | "out_time";
type OcrResult = { rows: RawRow[]; imagePath: string | null; localUrl: string; total: number | null; note?: string };

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** 휴대폰 사진은 커서(서버 업로드 한도 4.5MB) 긴 변 2400px JPEG로 줄인다. 글씨가 뭉개지지 않는 크기 */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9));
}

function Editor() {
  const router = useRouter();
  const params = useSearchParams();
  const [date, setDate] = useState(params.get("date") ?? today());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [writtenTotal, setWrittenTotal] = useState<number | null>(null);
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const names = useMemo(() => companies.map((c) => c.name), [companies]);

  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((d) => d.companies && setCompanies(d.companies)).catch(() => {});
  }, []);

  // 인식 결과의 날짜가 달라 날짜를 바꿨을 때, 그 날짜를 불러온 뒤 덧붙일 인식 결과
  const pending = useRef<{ date: string; ocrs: OcrResult[]; note: string } | null>(null);

  async function load(d: string) {
    setBusy("불러오는 중…");
    const r = await fetch(`/api/reports/${d}`);
    const j = await r.json();
    setBusy(null);
    if (!r.ok) return setMsg({ text: j.error, err: true });
    const base = {
      rows: (j.rows ?? []) as EditRow[],
      imagePaths: (j.image_paths ?? []) as string[],
      images: (j.images ?? []) as string[],
      writtenTotal: (j.written_total ?? null) as number | null,
    };
    setExists(j.exists);
    if (pending.current?.date === d) {
      const p = pending.current;
      pending.current = null;
      applyOcr(base, p.ocrs, p.note);
      return;
    }
    setRows(base.rows);
    setImagePaths(base.imagePaths);
    setImages(base.images);
    setWrittenTotal(base.writtenTotal);
    setDirty(false);
    setMsg(j.exists ? { text: `${koreanDate(d)} 저장된 기록 ${base.rows.length}건을 불러왔습니다.` } : null);
  }

  useEffect(() => { load(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 인식 결과(여러 장이면 순서대로)를 기존 행 뒤에 이어 붙임.
   * 장이 바뀌어도 〃·분만 적힌 시간은 바로 앞 장의 마지막 행을 이어받는다.
   */
  function applyOcr(
    base: { rows: EditRow[]; imagePaths: string[]; images: string[]; writtenTotal: number | null },
    ocrs: OcrResult[], note = "",
  ) {
    let all = [...base.rows];
    let paths = [...base.imagePaths];
    let imgs = [...base.images];
    let total = base.writtenTotal;
    const perPage: number[] = [];
    let nCheck = 0;

    for (const ocr of ocrs) {
      const last = all[all.length - 1];
      const lastT = last ? timeToMinutes(last.out_time) : null;
      const startSeq = all.length ? Math.max(...all.map((x) => x.seq)) + 1 : 1;
      const added = normalizeRows(ocr.rows, names, startSeq, {
        company: last?.company,
        time: lastT === null ? null : { h: Math.floor(lastT / 60), m: lastT % 60 },
      });
      all = [...all, ...added];
      if (ocr.imagePath) paths = [...paths, ocr.imagePath];
      imgs = [...imgs, ocr.localUrl];
      if (ocr.total !== null) total = ocr.total; // 총댓수는 마지막 장에 적힌 값을 씀
      perPage.push(added.length);
      nCheck += added.reduce((a, r) => a + Object.keys(r.check ?? {}).length, 0);
    }

    setRows(all);
    setImagePaths(paths);
    setImages(imgs);
    setWrittenTotal(total);
    setDirty(true);
    const pages = perPage.length > 1 ? ` (${perPage.map((n, i) => `${i + 1}장 ${n}건`).join(", ")})` : "";
    const sum = perPage.reduce((a, b) => a + b, 0);
    setMsg({ text: `${sum}건을 읽었습니다${pages}.${nCheck ? ` 노란 칸 ${nCheck}개를 사진과 비교해 확인해 주세요.` : ""}${note}` });
  }

  // 저장 안 하고 나가려 할 때 경고
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const changeDate = (d: string) => {
    if (!d || d === date) return;
    if (dirty && !confirm("저장하지 않은 내용이 있습니다. 날짜를 바꿀까요?")) return;
    setDate(d);
    router.replace(`/?date=${d}`);
  };

  /** 사진 1장 이상을 고른 순서대로 인식 (120대 넘는 날은 2장) */
  const recognize = async (picked: File[]) => {
    if (!picked.length) return;
    setMsg(null);
    // 갤러리에서 여러 장 고르면 순서가 섞일 수 있어 파일 이름(촬영 시각 순) 기준으로 정렬
    const files = picked.length > 1 ? [...picked].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : picked;
    const ocrs: OcrResult[] = [];
    let dateText = "";
    try {
      for (let i = 0; i < files.length; i++) {
        const label = files.length > 1 ? `(${i + 1}/${files.length}장) ` : "";
        const image = await shrink(files[i]);
        let j: Record<string, unknown> = {};
        // 무료 사용량의 '분당' 한도에 걸리면 안내된 시간만큼 기다렸다가 자동으로 다시 시도 (최대 3번)
        for (let attempt = 0; ; attempt++) {
          setBusy(`Gemini가 기록지를 읽는 중… ${label}20~40초`);
          const fd = new FormData();
          fd.append("image", image, "scan.jpg");
          fd.append("date", date);
          const r = await fetch("/api/ocr", { method: "POST", body: fd });
          j = await r.json().catch(() => ({ error: `서버 오류 (${r.status})` }));
          if (r.ok) break;
          if (r.status === 429 && j.quota && !j.daily && attempt < 3) {
            const wait = Math.min(90, Number(j.retryAfter) || 30) + 2;
            for (let s = wait; s > 0; s--) {
              setBusy(`Gemini 무료 사용량 한도에 걸려 잠시 기다리는 중… ${label}${s}초 뒤 자동으로 다시 읽습니다`);
              await new Promise((res) => setTimeout(res, 1000));
            }
            continue;
          }
          throw new Error(`${files.length > 1 ? `${i + 1}번째 사진: ` : ""}${j.error}`);
        }
        const total = parseInt(String(j.total_text).replace(/\D/g, ""), 10);
        ocrs.push({
          rows: j.rows as RawRow[],
          imagePath: (j.imagePath as string | null) ?? null,
          localUrl: URL.createObjectURL(files[i]),
          total: Number.isFinite(total) ? total : null,
        });
        if (!dateText && j.date_text) dateText = String(j.date_text);
      }
    } catch (e) {
      setBusy(null);
      // 앞 장은 성공했으면 그만큼은 넣어 둔다
      if (ocrs.length) applyOcr({ rows, imagePaths, images, writtenTotal }, ocrs,
        ` ⚠ ${(e as Error).message} — 그 사진은 다시 올려 주세요.`);
      else setMsg({ text: (e as Error).message, err: true });
      return;
    }
    setBusy(null);

    // 기록지의 '월일'이 선택한 날짜와 다르면: 아직 아무것도 없을 때만 그 날짜로 옮김
    const formDate = parseFormDate(dateText, Number(date.slice(0, 4)));
    if (formDate && formDate !== date && !rows.length && !exists && !dirty) {
      pending.current = { date: formDate, ocrs, note: ` 기록지 날짜(${dateText})에 맞춰 ${koreanDate(formDate)}로 바꿨습니다.` };
      setDate(formDate);
      router.replace(`/?date=${formDate}`);
      return; // load(formDate)가 끝나면 applyOcr로 이어 붙음
    }
    const note = formDate && formDate !== date
      ? ` ⚠ 기록지 날짜는 ${dateText}인데 ${koreanDate(date)}에 넣었습니다. 날짜를 확인하세요.` : "";
    applyOcr({ rows, imagePaths, images, writtenTotal }, ocrs, note);
  };

  const update = (i: number, f: Field, v: string) => {
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const check = { ...(r.check ?? {}) };
      delete check[f];
      return { ...r, [f]: v, check };
    }));
    setDirty(true);
  };
  /** 시간 칸에서 분만 입력하면 위 행의 시를 붙여 줌 */
  const fixTime = (i: number) => {
    const v = rows[i].out_time;
    if (/^\d{1,2}:\d{2}$/.test(v) || !v) return;
    const prev = i > 0 ? timeToMinutes(rows[i - 1].out_time) : null;
    const t = parseTime(v, prev === null ? null : { h: Math.floor(prev / 60), m: prev % 60 });
    if (t) update(i, "out_time", t.value);
  };
  const insertBelow = (i: number) => {
    const r = rows[i];
    setRows([...rows.slice(0, i + 1), { seq: r.seq + 0.5, vehicle_no: "", company: r.company, out_time: "" }, ...rows.slice(i + 1)]
      .map((x, k) => ({ ...x, seq: k + 1 })));
    setDirty(true);
  };
  const remove = (i: number) => {
    setRows(rows.filter((_, j) => j !== i).map((x, k) => ({ ...x, seq: k + 1 })));
    setDirty(true);
  };

  const save = async () => {
    setBusy("저장 중…");
    const r = await fetch(`/api/reports/${date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, written_total: writtenTotal, image_paths: imagePaths }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) return setMsg({ text: j.error, err: true });
    setDirty(false);
    setExists(true);
    setRows(rows.map((x, k) => ({ ...x, seq: k + 1, check: {} })));
    setMsg({ text: `${koreanDate(date)} — ${j.saved}건 저장했습니다.` });
  };

  const removeDay = async () => {
    if (!confirm(`${koreanDate(date)} 기록을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await fetch(`/api/reports/${date}`, { method: "DELETE" });
    load(date);
  };

  // 집계
  const tally = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => r.company && m.set(r.company, (m.get(r.company) ?? 0) + 1));
    return m;
  }, [rows]);
  const nCheck = rows.reduce((a, r) => a + Object.keys(r.check ?? {}).length, 0);
  const unknown = [...tally.keys()].filter((n) => !names.includes(n));

  const jumpToCheck = () => {
    const el = document.querySelector<HTMLInputElement>("td.doubt input");
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>폐기물 반출 현황 입력</h1>
          <p className="sub">기록지 사진을 올리면 표로 옮겨 드려요. 사진과 비교해 고친 뒤 저장하세요.</p>
        </div>
        <label className="f">날짜
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
        </label>
      </div>

      <section className="card upload">
        <div className="row">
          <button disabled={!!busy} onClick={() => camRef.current?.click()}>📷 촬영해서 인식</button>
          <button className="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>사진 선택 (여러 장 가능)</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { recognize(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { recognize(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <span className="hint">
            120대가 넘는 날은 두 장을 한꺼번에 고르거나, 첫 장 인식 후 둘째 장을 찍으면 121번부터 이어집니다.
          </span>
        </div>
        {busy && <div className="msg busy">{busy}</div>}
        {msg && <div className={`msg ${msg.err ? "err" : ""}`}>{msg.text}</div>}
      </section>

      <div className={`work ${images.length ? "has-img" : ""}`}>
        {images.length > 0 && (
          <aside className="scan">
            {images.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" title="크게 보기">
                <img src={u} alt={`기록지 사진 ${i + 1}`} />
              </a>
            ))}
          </aside>
        )}

        <section className="card table-card">
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th className="idx">연번</th><th>차량번호</th><th>업체</th><th>시간</th><th className="act" /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="idx">{r.seq}</td>
                    {(["vehicle_no", "company", "out_time"] as Field[]).map((f) => (
                      <td key={f} className={r.check?.[f] ? "doubt" : ""} title={r.check?.[f] ?? ""}>
                        <input
                          value={r[f]}
                          inputMode={f === "company" ? "text" : "numeric"}
                          list={f === "company" ? "company-list" : undefined}
                          onChange={(e) => update(i, f, e.target.value)}
                          onBlur={f === "out_time" ? () => fixTime(i) : undefined}
                          aria-label={`${r.seq}번 ${f === "vehicle_no" ? "차량번호" : f === "company" ? "업체" : "시간"}`}
                        />
                      </td>
                    ))}
                    <td className="act">
                      <button className="icon" title="아래에 행 추가" onClick={() => insertBelow(i)}>＋</button>
                      <button className="icon" title="행 삭제" onClick={() => remove(i)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="company-list">{names.map((n) => <option key={n} value={n} />)}</datalist>
            {!rows.length && <p className="empty">아직 행이 없습니다. 기록지를 촬영하거나 직접 추가하세요.</p>}
            <button className="ghost small" onClick={() => {
              const last = rows[rows.length - 1];
              setRows([...rows, { seq: rows.length + 1, vehicle_no: "", company: last?.company ?? "", out_time: "" }]);
              setDirty(true);
            }}>+ 행 추가</button>
          </div>
        </section>

        <aside className="card tally">
          <div className="total">
            <span>금일합계</span><b>{rows.length}</b>
          </div>
          {writtenTotal !== null && writtenTotal !== rows.length && (
            <p className="warn">기록지 총댓수 {writtenTotal}대와 다릅니다</p>
          )}
          <table>
            <tbody>
              {companies.filter((c) => tally.get(c.name) || c.separate).map((c) => (
                <tr key={c.name} className={c.separate ? "sep" : ""}><td>{c.name}</td><td>{tally.get(c.name) ?? 0}</td></tr>
              ))}
              {unknown.map((n) => (
                <tr key={n} className="unknown" title="업체 목록에 없는 이름"><td>{n}</td><td>{tally.get(n)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="legend">0대인 업체는 숨김 · 엑셀에는 전체 표시</p>
        </aside>
      </div>

      <div className="savebar">
        <span>
          {koreanDate(date)} · {rows.length}건
          {nCheck > 0 && <button className="linkish" onClick={jumpToCheck}>확인 필요 {nCheck}칸 →</button>}
          {dirty && <em> · 저장 안 됨</em>}
        </span>
        <span className="row">
          {exists && <a href={`/api/export?date=${date}`}><button className="ghost" disabled={dirty} title={dirty ? "먼저 저장하세요" : ""}>엑셀 받기</button></a>}
          {exists && <button className="danger" onClick={removeDay}>삭제</button>}
          <button disabled={!!busy || !dirty} onClick={save}>저장</button>
        </span>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Editor /></Suspense>;
}
