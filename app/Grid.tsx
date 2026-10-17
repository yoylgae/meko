"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { isDitto, parseTime, timeToMinutes, type EditRow } from "@/lib/form";

/**
 * 엑셀처럼 고치는 표
 * - 클릭·끌기·Shift+클릭으로 범위 선택, 방향키·Tab·Enter 이동, Shift+방향키로 범위 넓히기
 * - 바로 입력하면 덮어쓰기, F2·더블클릭은 이어서 고치기, Esc 취소
 * - Ctrl+C / X / V (엑셀·구글시트와 주고받기 가능), 한 칸을 복사해 여러 칸에 붙이면 모두 채움
 * - 채우기 핸들(선택 오른쪽 아래 점)을 아래로 끌어 복사, Ctrl+D 아래로 채우기
 * - Delete 지우기, Ctrl+Z / Ctrl+Y 되돌리기·다시 실행, 오른쪽 클릭 메뉴(행 삽입·삭제)
 */

const COLS = ["vehicle_no", "company", "out_time"] as const;
type Col = (typeof COLS)[number];
const LABEL: Record<Col, string> = { vehicle_no: "차량번호", company: "업체", out_time: "시간" };
type Pos = { r: number; c: number };
type Sel = { a: Pos; f: Pos }; // a = 시작(고정점), f = 현재 칸
type Edit = { r: number; c: number; v: string };

export type GridHandle = { jumpToNextCheck: () => void };

const emptyRow = (seq: number): EditRow => ({ seq, vehicle_no: "", company: "", out_time: "", check: {} });
const renumber = (rows: EditRow[]) => rows.map((x, k) => ({ ...x, seq: k + 1 }));

/** 값 고치기 (+ 검사 표시 갱신). 위에서부터 차례로 적용해서 시간·〃이 바로 위 행을 이어받게 함 */
function applyEdits(rows: EditRow[], edits: Edit[], names: string[]): EditRow[] {
  const next: (EditRow & { check: NonNullable<EditRow["check"]> })[] =
    rows.map((r) => ({ ...r, check: { ...(r.check ?? {}) } }));
  const sorted = [...edits].sort((x, y) => x.r - y.r || x.c - y.c);
  for (const { r, c, v: raw } of sorted) {
    while (next.length <= r) next.push({ ...emptyRow((next[next.length - 1]?.seq ?? 0) + 1), check: {} });
    const row = next[r];
    const col = COLS[c];
    let v = String(raw ?? "").trim();
    delete row.check[col];
    if (col === "vehicle_no") {
      if (v && !/^\d{4}$/.test(v)) row.check.vehicle_no = "차량번호 4자리인지 확인";
    } else if (col === "company") {
      if (v && isDitto(v)) v = next[r - 1]?.company ?? "";
      if (v && names.length && !names.includes(v)) row.check.company = "등록되지 않은 업체 — 목록에서 고르거나 '업체' 화면에서 먼저 추가하세요";
    } else if (col === "out_time" && v) {
      const pm = r > 0 ? timeToMinutes(next[r - 1].out_time) : null;
      const t = parseTime(v, pm === null ? null : { h: Math.floor(pm / 60), m: pm % 60 });
      if (t) { v = t.value; if (t.note) row.check.out_time = t.note; }
      else row.check.out_time = "시간 형식 확인";
    }
    row[col] = v;
  }
  return next;
}

function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l.split("\t"));
}

const Grid = forwardRef<GridHandle, {
  rows: EditRow[];
  names: string[];
  onChange: (rows: EditRow[]) => void;
}>(function Grid({ rows, names, onChange }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState<Sel>({ a: { r: 0, c: 0 }, f: { r: 0, c: 0 } });
  const [editing, setEditing] = useState<null | "replace" | "edit">(null);
  const [draft, setDraft] = useState("");
  const [fillTo, setFillTo] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false);
  const past = useRef<EditRow[][]>([]);
  const future = useRef<EditRow[][]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const lastRow = rows.length; // 맨 아래 빈 줄(여기 입력하면 새 행)
  const top = Math.min(sel.a.r, sel.f.r), bottom = Math.max(sel.a.r, sel.f.r);
  const left = Math.min(sel.a.c, sel.f.c), right = Math.max(sel.a.c, sel.f.c);
  const clampR = (r: number) => Math.max(0, Math.min(lastRow, r));
  const clampC = (c: number) => Math.max(0, Math.min(COLS.length - 1, c));

  // ── 변경·되돌리기 ──
  const emit = useCallback((next: EditRow[]) => {
    past.current.push(rowsRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    onChange(next);
  }, [onChange]);
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(rowsRef.current);
    onChange(prev);
  };
  const redo = () => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(rowsRef.current);
    onChange(nxt);
  };
  const edit = (edits: Edit[]) => { if (edits.length) emit(applyEdits(rowsRef.current, edits, names)); };

  // ── 선택 ──
  const select = (f: Pos, extend = false, maxR = lastRow) => {
    const p = { r: Math.max(0, Math.min(maxR, f.r)), c: clampC(f.c) };
    setSel((s) => ({ a: extend ? s.a : p, f: p }));
  };
  const cellValue = (r: number, c: number) => rows[r]?.[COLS[c]] ?? "";
  const rangeCells = () => {
    const out: Pos[] = [];
    for (let r = top; r <= Math.min(bottom, rows.length - 1); r++) for (let c = left; c <= right; c++) out.push({ r, c });
    return out;
  };

  // 현재 칸이 바뀌면 입력칸에 초점 + 화면 안으로
  useLayoutEffect(() => {
    if (!active) return;
    editorRef.current?.focus({ preventScroll: true });
    wrapRef.current?.querySelector(`td[data-r="${sel.f.r}"][data-c="${sel.f.c}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel.f.r, sel.f.c, active, editing]);

  // ── 입력 ──
  const commit = (move?: [number, number]) => {
    let grew = false; // 맨 아래 빈 줄에 입력해서 행이 하나 늘었는지
    if (editing) {
      const isGhost = sel.f.r === rows.length;
      if (isGhost ? draft.trim() !== "" : draft.trim() !== cellValue(sel.f.r, sel.f.c)) {
        edit([{ r: sel.f.r, c: sel.f.c, v: draft }]);
        grew = isGhost;
      }
    }
    setEditing(null);
    setDraft("");
    if (move) {
      let { r, c } = sel.f;
      c += move[1];
      if (c > COLS.length - 1) { c = 0; r += 1; }
      if (c < 0) { c = COLS.length - 1; r -= 1; }
      select({ r: r + move[0], c }, false, lastRow + (grew ? 1 : 0));
    }
  };
  const cancel = () => { setEditing(null); setDraft(""); };
  const startEdit = () => { setEditing("edit"); setDraft(cellValue(sel.f.r, sel.f.c)); };

  // ── 복사·붙여넣기 ──
  const selectionTSV = () => {
    const lines: string[] = [];
    for (let r = top; r <= Math.min(bottom, rows.length - 1); r++) {
      const cells: string[] = [];
      for (let c = left; c <= right; c++) cells.push(cellValue(r, c));
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };
  const clearSelection = () => edit(rangeCells().map(({ r, c }) => ({ r, c, v: "" })));
  const pasteText = (text: string) => {
    if (!text) return;
    let data = parseClipboard(text);
    // 엑셀에서 '연번'까지 같이 복사해 온 경우: 첫 열이 숫자뿐이면 빼고 붙임
    if (left === 0 && data[0].length >= 4 && data.every((row) => /^\s*\d*\s*$/.test(row[0] ?? ""))) data = data.map((row) => row.slice(1));
    const edits: Edit[] = [];
    if (data.length === 1 && data[0].length === 1 && (bottom > top || right > left)) {
      // 한 칸을 여러 칸에 붙이면 모두 같은 값으로
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) edits.push({ r, c, v: data[0][0] });
    } else {
      data.forEach((row, i) => row.forEach((v, j) => {
        const c = left + j;
        if (c < COLS.length) edits.push({ r: top + i, c, v });
      }));
      setSel({ a: { r: top, c: left }, f: { r: top + data.length - 1, c: clampC(left + data[0].length - 1) } });
    }
    edit(edits);
  };

  // ── 행 ──
  const insertRows = (at: number) => {
    const n = bottom - top + 1;
    const next = [...rowsRef.current];
    next.splice(at, 0, ...Array.from({ length: n }, () => emptyRow(0)));
    emit(renumber(next));
    setSel({ a: { r: at, c: left }, f: { r: at + n - 1, c: right } });
  };
  const deleteRows = () => {
    const end = Math.min(bottom, rows.length - 1);
    if (end < top) return;
    emit(renumber(rowsRef.current.filter((_, i) => i < top || i > end)));
    select({ r: top, c: sel.f.c });
  };
  const fillDown = (to: number) => {
    // 선택 범위를 to 행까지 반복해서 복사 (한 줄만 골랐으면 그 줄을 복사)
    const h = Math.min(bottom, rows.length - 1) - top + 1;
    if (h < 1 || to <= bottom) return;
    const edits: Edit[] = [];
    for (let r = bottom + 1; r <= to; r++) for (let c = left; c <= right; c++) edits.push({ r, c, v: cellValue(top + ((r - bottom - 1) % h), c) });
    edit(edits);
    setSel({ a: { r: top, c: left }, f: { r: to, c: right } });
  };

  // ── 키보드 ──
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.nativeEvent.isComposing) return; // 한글 조합 중
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
      else if (e.key === "Tab") { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (editing === "replace" && e.key.startsWith("Arrow")) {
        e.preventDefault();
        commit(e.key === "ArrowUp" ? [-1, 0] : e.key === "ArrowDown" ? [1, 0] : e.key === "ArrowLeft" ? [0, -1] : [0, 1]);
      }
      return;
    }
    const k = e.key;
    const jump = (d: number, max: number, cur: number) => (mod ? (d > 0 ? max : 0) : cur + d);
    if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      select({ r: jump(k === "ArrowUp" ? -1 : 1, lastRow, sel.f.r), c: sel.f.c }, e.shiftKey);
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      select({ r: sel.f.r, c: jump(k === "ArrowLeft" ? -1 : 1, COLS.length - 1, sel.f.c) }, e.shiftKey);
    } else if (k === "Tab") {
      e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]);
    } else if (k === "Enter") {
      e.preventDefault(); select({ r: sel.f.r + (e.shiftKey ? -1 : 1), c: sel.f.c });
    } else if (k === "F2") {
      e.preventDefault(); startEdit();
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); clearSelection();
    } else if (k === "Escape") {
      setMenu(null);
    } else if (mod && (k === "z" || k === "Z")) {
      e.preventDefault(); if (e.shiftKey) redo(); else undo();
    } else if (mod && (k === "y" || k === "Y")) {
      e.preventDefault(); redo();
    } else if (mod && (k === "d" || k === "D")) {
      e.preventDefault();
      if (bottom > top) { // 선택 맨 윗줄을 아래로 채움
        const edits: Edit[] = [];
        for (let r = top + 1; r <= bottom; r++) for (let c = left; c <= right; c++) edits.push({ r, c, v: cellValue(top, c) });
        edit(edits);
      } else if (top > 0) {
        edit(Array.from({ length: right - left + 1 }, (_, i) => ({ r: top, c: left + i, v: cellValue(top - 1, left + i) })));
      }
    } else if (mod && (k === "a" || k === "A")) {
      e.preventDefault(); setSel({ a: { r: 0, c: 0 }, f: { r: Math.max(0, rows.length - 1), c: COLS.length - 1 } });
    }
    // 그 밖의 글자는 입력칸에 그대로 들어가서(onChange) 덮어쓰기 시작
  };

  // ── 마우스·터치 ──
  const posFromPoint = (x: number, y: number): Pos | null => {
    const td = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.("td[data-r]") as HTMLElement | null;
    if (!td || !wrapRef.current?.contains(td)) return null;
    return { r: Number(td.dataset.r), c: Number(td.dataset.c) };
  };
  const autoScroll = (y: number) => {
    if (y > window.innerHeight - 60) window.scrollBy(0, 18);
    else if (y < 110) window.scrollBy(0, -18);
  };
  const onCellPointerDown = (e: React.PointerEvent, p: Pos) => {
    setMenu(null);
    setActive(true);
    if (e.button === 2) { // 오른쪽 클릭: 선택 안이면 그대로
      if (!(p.r >= top && p.r <= bottom && p.c >= left && p.c <= right)) select(p);
      return;
    }
    if (editing) {
      if (p.r === sel.f.r && p.c === sel.f.c) return; // 고치는 중인 칸 안 클릭은 입력칸이 처리
      commit();
    }
    if (e.pointerType === "touch") { // 휴대폰: 누르면 바로 고치기
      select(p);
      setEditing("edit");
      setDraft(cellValue(clampR(p.r), p.c));
      return;
    }
    e.preventDefault();
    select(p, e.shiftKey);
    const move = (ev: PointerEvent) => {
      autoScroll(ev.clientY);
      const q = posFromPoint(ev.clientX, ev.clientY);
      if (q) select(q, true);
    };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  const onFillPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (editing) commit();
    let target = bottom;
    setFillTo(bottom);
    const move = (ev: PointerEvent) => {
      autoScroll(ev.clientY);
      const q = posFromPoint(ev.clientX, ev.clientY);
      if (q) { target = Math.max(bottom, q.r); setFillTo(target); }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      setFillTo(null);
      fillDown(target);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  // 바깥을 누르면 선택 표시 끄기, 메뉴 닫기
  useEffect(() => {
    const out = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        if (editing) commit();
        setActive(false);
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  });

  useImperativeHandle(ref, () => ({
    jumpToNextCheck: () => {
      const cells: Pos[] = [];
      rows.forEach((r, i) => COLS.forEach((col, c) => { if (r.check?.[col]) cells.push({ r: i, c }); }));
      if (!cells.length) return;
      const after = cells.find((p) => p.r > sel.f.r || (p.r === sel.f.r && p.c > sel.f.c)) ?? cells[0];
      setActive(true);
      select(after);
      setTimeout(() => wrapRef.current?.querySelector(`td[data-r="${after.r}"][data-c="${after.c}"]`)
        ?.scrollIntoView({ block: "center" }), 0);
    },
  }));

  const menuAct = async (fn: string) => {
    setMenu(null);
    if (fn === "copy" || fn === "cut") {
      try { await navigator.clipboard.writeText(selectionTSV()); } catch { /* 권한 없음 */ }
      if (fn === "cut") clearSelection();
    } else if (fn === "paste") {
      try { pasteText(await navigator.clipboard.readText()); }
      catch { alert("브라우저가 메뉴에서 붙여넣기를 막았습니다. Ctrl+V(휴대폰은 길게 눌러 붙여넣기)를 사용하세요."); }
    } else if (fn === "above") insertRows(top);
    else if (fn === "below") insertRows(Math.min(bottom, rows.length - 1) + 1);
    else if (fn === "delrows") deleteRows();
    else if (fn === "clear") clearSelection();
    else if (fn === "undo") undo();
    else if (fn === "redo") redo();
    editorRef.current?.focus({ preventScroll: true });
  };

  const nSel = (Math.min(bottom, rows.length - 1) - top + 1) * (right - left + 1);
  const all = [...rows, null]; // null = 맨 아래 새 행

  return (
    <div className={`xgrid ${active ? "active" : ""}`} ref={wrapRef} onContextMenu={(e) => { e.preventDefault(); setActive(true); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="xgrid-bar">
        <button className="ghost small" onClick={() => menuAct("undo")} disabled={!past.current.length} title="Ctrl+Z">↶ 되돌리기</button>
        <button className="ghost small" onClick={() => menuAct("redo")} disabled={!future.current.length} title="Ctrl+Y">↷ 다시</button>
        <button className="ghost small" onClick={() => menuAct("below")} disabled={!rows.length}>아래에 행 삽입</button>
        <button className="ghost small" onClick={() => menuAct("delrows")} disabled={!rows.length || top >= rows.length}>선택 행 삭제</button>
        <span className="xgrid-info">
          {active && nSel > 1 ? `${Math.min(bottom, rows.length - 1) - top + 1}행 × ${right - left + 1}열 선택 · ` : ""}
          드래그로 범위 선택 · Ctrl+C/V · 오른쪽 아래 점 끌어 채우기 · 오른쪽 클릭 메뉴
        </span>
      </div>
      <div className="table-wrap">
        <table className="grid xg">
          <thead>
            <tr><th className="idx">연번</th>{COLS.map((c) => <th key={c}>{LABEL[c]}</th>)}</tr>
          </thead>
          <tbody>
            {all.map((r, i) => (
              <tr key={i} className={r ? "" : "ghost"}>
                <td className={`idx ${active && i >= top && i <= bottom ? "hl" : ""}`}
                  onPointerDown={(e) => { // 연번 누르면 행 전체 선택
                    e.preventDefault(); setActive(true); if (editing) commit();
                    setSel((s) => ({ a: { r: e.shiftKey ? s.a.r : i, c: 0 }, f: { r: i, c: COLS.length - 1 } }));
                  }}>
                  {r ? r.seq : "+"}
                </td>
                {COLS.map((col, c) => {
                  const inSel = active && i >= top && i <= bottom && c >= left && c <= right;
                  const cur = sel.f.r === i && sel.f.c === c;
                  const inFill = fillTo !== null && i > bottom && i <= fillTo && c >= left && c <= right;
                  const note = r?.check?.[col];
                  return (
                    <td key={col} data-r={i} data-c={c}
                      className={[note ? "doubt" : "", inSel ? "sel" : "", cur && active ? "cur" : "", inFill ? "fill" : ""].join(" ")}
                      title={note ?? ""}
                      onPointerDown={(e) => onCellPointerDown(e, { r: i, c })}
                      onDoubleClick={() => { if (!editing) startEdit(); }}>
                      <div className="cell">{editing && cur ? "" : (r?.[col] ?? "")}</div>
                      {cur && (
                        <input
                          ref={editorRef}
                          className={`editor ${editing ? "on" : ""}`}
                          value={editing ? draft : ""}
                          list={col === "company" ? "company-list" : undefined}
                          inputMode={col === "company" ? "text" : "numeric"}
                          aria-label={`${r ? r.seq + "번" : "새 행"} ${LABEL[col]}`}
                          onChange={(e) => { if (!editing) setEditing("replace"); setDraft(e.target.value); }}
                          onKeyDown={onKeyDown}
                          onBlur={() => { if (editing) commit(); }}
                          onCopy={(e) => { if (editing) return; e.preventDefault(); e.clipboardData.setData("text/plain", selectionTSV()); }}
                          onCut={(e) => { if (editing) return; e.preventDefault(); e.clipboardData.setData("text/plain", selectionTSV()); clearSelection(); }}
                          onPaste={(e) => { if (editing) return; e.preventDefault(); pasteText(e.clipboardData.getData("text/plain")); }}
                        />
                      )}
                      {active && !editing && i === bottom && c === right && i < rows.length && (
                        <span className="fill-handle" onPointerDown={onFillPointerDown} title="끌어서 아래로 채우기" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="company-list">{names.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      {menu && (
        <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 330) }}
          onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => menuAct("copy")}>복사 <kbd>Ctrl+C</kbd></button>
          <button onClick={() => menuAct("cut")}>잘라내기 <kbd>Ctrl+X</kbd></button>
          <button onClick={() => menuAct("paste")}>붙여넣기 <kbd>Ctrl+V</kbd></button>
          <button onClick={() => menuAct("clear")}>내용 지우기 <kbd>Del</kbd></button>
          <hr />
          <button onClick={() => menuAct("above")} disabled={!rows.length}>위에 행 삽입</button>
          <button onClick={() => menuAct("below")} disabled={!rows.length}>아래에 행 삽입</button>
          <button onClick={() => menuAct("delrows")} disabled={top >= rows.length}>선택 행 삭제</button>
          <hr />
          <button onClick={() => menuAct("undo")} disabled={!past.current.length}>되돌리기 <kbd>Ctrl+Z</kbd></button>
          <button onClick={() => menuAct("redo")} disabled={!future.current.length}>다시 실행 <kbd>Ctrl+Y</kbd></button>
        </div>
      )}
    </div>
  );
});

export default Grid;
