import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "폐기물 반출 현황",
  description: "손으로 쓴 반출 기록지를 사진으로 찍어 엑셀 표로 옮기고 날짜별로 저장합니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="top">
          <Link href="/" className="brand">폐기물 반출 현황</Link>
          <nav>
            <Link href="/">입력</Link>
            <Link href="/history">기록</Link>
            <Link href="/settings">업체</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
