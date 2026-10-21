"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RotatableImage from "./RotatableImage";
import Grid, { type GridHandle } from "./Grid";
import {
  normalizeRows, parseFormDate, koreanDate, timeToMinutes,
  type Company, type EditRow, type RawRow,
} from "@/lib/form";

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
  const gridRef = useRef<GridHandle>(null);

  const names = useMemo(() => companies.map((c) => c.name), [companies]);
  const frequent = useMemo(() => companies.filter((c) => c.frequent).map((c) => c.name), [companies]);

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
      }, frequent);
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
        setBusy(`Gemini가 기록지를 읽는 중… ${label}20~40초`);
        const fd = new FormData();
        fd.append("image", image, "scan.jpg");
        fd.append("date", date);
        const r = await fetch("/api/ocr", { method: "POST", body: fd });
        const j: Record<string, unknown> = await r.json().catch(() => ({
          error: r.status === 504 ? "인식 시간이 너무 오래 걸려 중단됐습니다. 사진을 다시 올려 주세요." : `서버 오류 (${r.status})`,
        }));
        if (!r.ok) throw new Error(`${files.length > 1 ? `${i + 1}번째 사진: ` : ""}${j.error}`);
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

  const jumpToCheck = () => gridRef.current?.jumpToNextCheck();

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
              <RotatableImage key={u} src={u} alt={`기록지 사진 ${i + 1}`} />
            ))}
          </aside>
        )}

        <section className="card table-card">
          <Grid ref={gridRef} rows={rows} names={names} frequent={frequent} onChange={(rs) => { setRows(rs); setDirty(true); }} />
          {!rows.length && <p className="empty">아직 행이 없습니다. 기록지를 촬영하거나, 맨 아래 칸에 바로 입력하거나, 엑셀에서 복사해 붙여 넣으세요.</p>}
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
              {companies.filter((c) => tally.get(c.name) || c.separate || c.frequent).map((c) => (
                <tr key={c.name} className={c.separate ? "sep" : ""}><td>{c.frequent ? "★ " : ""}{c.name}</td><td>{tally.get(c.name) ?? 0}</td></tr>
              ))}
              {unknown.map((n) => (
                <tr key={n} className="unknown" title="업체 목록에 없는 이름"><td>{n}</td><td>{tally.get(n)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="legend">★ 자주 오는 업체는 항상 표시 · 나머지 0대 업체는 숨김 · 엑셀에는 전체 표시</p>
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
