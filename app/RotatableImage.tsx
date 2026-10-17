"use client";
import { useEffect, useRef, useState } from "react";

/**
 * 인식한 기록지 사진 보기 — 90° 버튼·자유 각도 슬라이더(Shift+휠)로 회전.
 * 기울여도 칸 밖으로 잘리지 않게 회전한 모양의 바깥 상자 크기에 맞춰 축소해서 보여 준다.
 */
export default function RotatableImage({ src, alt }: { src: string; alt: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0);       // -180 ~ 180
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [boxW, setBoxW] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    // Shift+마우스 휠로 1°씩 미세 회전 (페이지 스크롤은 막음 — React 휠 이벤트는 막을 수 없어 직접 등록)
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      const d = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
      setAngle((a) => ((((a + d + 180) % 360) + 360) % 360) - 180);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, []);

  const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
  const turn = (d: number) => setAngle((a) => norm(a + d));

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

  return (
    <figure className="rot">
      <div className="rot-tools" role="toolbar" aria-label="사진 회전">
        <button type="button" className="ghost small" onClick={() => turn(-90)} title="왼쪽으로 90°">↺ 90°</button>
        <button type="button" className="ghost small" onClick={() => turn(90)} title="오른쪽으로 90°">↻ 90°</button>
        <input
          type="range" min={-180} max={180} step={0.5} value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          aria-label="회전 각도"
        />
        <span className="rot-deg">{angle > 0 ? "+" : ""}{angle.toFixed(angle % 1 ? 1 : 0)}°</span>
        {angle !== 0 && <button type="button" className="ghost small" onClick={() => setAngle(0)}>원래대로</button>}
        <a href={src} target="_blank" rel="noreferrer" className="rot-open" title="새 창에서 원본 크기로">원본</a>
      </div>
      <div ref={boxRef} className="rot-box" style={{ height: outH || 240 }} title="Shift+마우스 휠로 1°씩 돌릴 수 있어요">
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
    </figure>
  );
}
