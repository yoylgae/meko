import type { Metadata, Viewport } from "next";
import Shell from "./Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "폐기물 반출 현황",
  description: "손으로 쓴 반출 기록지를 사진으로 찍어 엑셀 표로 옮기고 현장·날짜별로 저장합니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
