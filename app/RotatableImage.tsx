"use client";
import { useEffect, useRef, useState } from "react";

/**
 * 인식한 기록지 사진 보기
 * - 마우스 휠: 커서 위치를 기준으로 확대·축소 (1배~8배), 확대한 상태에서 끌어서 이동
 * - 휴대폰: 두 손가락으로 벌려 확대, 한 손가락으로 이동
 * - Shift+휠: 1°씩 회전, 90° 버튼·슬라이더로 회전
 * - 더블클릭 또는 '원래대로': 확대·회전 초기화
 * 기울여도 칸 밖으로 잘리지 않게 회전한 모양의 바깥 상자 크기에 맞춰 축소해서 보여 준다.
 */
const MIN_Z = 1, MAX_Z = 8;

export default function RotatableImage({ src, alt }: { src: string; alt: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0);       // -180 ~ 180
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 }); // 확대 배율·이동(px)
  const viewRef = useRef(view);
  viewRef.current = view;

  /** (cx, cy) 지점을 고정한 채 배율을 z로 */
  const zoomAt = (z: number, cx: number, cy: number) => {
    const v = viewRef.current;
    const nz = Math.max(MIN_Z, Math.min(MAX_Z, z));
    if (nz === MIN_Z) return setView({ z: 1, x: 0, y: 0 });
    const k = nz / v.z;
    setView({ z: nz, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  };
  const zoomCenter = (factor: number) => {
    const el = boxRef.current;
    if (!el) return;
    zoomAt(viewRef.current.z * factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    // 휠: 확대·축소 / Shift+휠: 1°씩 회전 (페이지 스크롤은 막음 — React 휠 이벤트는 막을 수 없어 직접 등록)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        const d = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
        setAngle((a) => ((((a + d + 180) % 360) + 360) % 360) - 180);
        return;
      }
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)); // 휠 한 칸 ≈ 1.16배
      zoomAt(viewRef.current.z * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, []);

  // 끌어서 이동 (확대했을 때) + 두 손가락 확대
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: viewRef.current.z };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.current.z * (d / pinch.current.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    } else if (pointers.current.size === 1 && viewRef.current.z > 1) {
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
  const turn = (d: number) => setAngle((a) => norm(a + d));
  const reset = () => { setAngle(0); setView({ z: 1, x: 0, y: 0 }); };

  // 원래 비율로 칸 너비에 맞춘 크기 → 회전했을 때 바깥 상자 → 칸 너비에 다시 맞춤
  let imgW = boxW, imgH = 0, outH = 0, scale = 1;
  if (natural && boxW) {
    imgH = (boxW * natural.h) / natural.w;
    const r = (angle * Math.PI) / 180;
    const bw = Math.abs(imgW * Math.cos(r)) + Math.abs(imgH * Math.sin(r));
    const bh = Math.abs(imgW * Math.sin(r)) + Math.abs(imgH * Math.cos(r));
    scale = boxW / bw;
    outH = bh * scale;
  }
  const zoomed = view.z > 1;

  return (
    <figure className="rot">
      <div className="rot-tools" role="toolbar" aria-label="사진 회전·확대">
        <button type="button" className="ghost small" onClick={() => turn(-90)} title="왼쪽으로 90°">↺ 90°</button>
        <button type="button" className="ghost small" onClick={() => turn(90)} title="오른쪽으로 90°">↻ 90°</button>
        <input
          type="range" min={-180} max={180} step={0.5} value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          aria-label="회전 각도"
        />
        <span className="rot-deg">{angle > 0 ? "+" : ""}{angle.toFixed(angle % 1 ? 1 : 0)}°</span>
        <span className="rot-zoom">
          <button type="button" className="ghost small" onClick={() => zoomCenter(1 / 1.4)} disabled={!zoomed} aria-label="축소">－</button>
          <span className="rot-deg">{Math.round(view.z * 100)}%</span>
          <button type="button" className="ghost small" onClick={() => zoomCenter(1.4)} disabled={view.z >= MAX_Z} aria-label="확대">＋</button>
        </span>
        {(angle !== 0 || zoomed) && <button type="button" className="ghost small" onClick={reset}>원래대로</button>}
        <a href={src} target="_blank" rel="noreferrer" className="rot-open" title="새 창에서 원본 크기로">원본</a>
      </div>
      <div
        ref={boxRef}
        className={`rot-box ${zoomed ? "zoomed" : ""}`}
        style={{ height: outH || 240 }}
        title="휠: 확대·축소 · 끌기: 이동 · Shift+휠: 회전 · 더블클릭: 원래대로"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
      >
        <div className="rot-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{
              width: imgW || "100%",
              transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`,
            }}
          />
        </div>
      </div>
    </figure>
  );
}
