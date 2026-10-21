import { NextRequest, NextResponse } from "next/server";
import { OcrFailed, readPage } from "@/lib/ocr";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";

export const runtime = "nodejs";
// Gemini가 느릴 때(다른 모델로 넘기는 경우 포함)까지 기다릴 수 있게
export const maxDuration = 300;

/** 기록지 사진 1장 → Gemini가 보이는 그대로 읽은 값(정리 전). 원본 사진은 현장 폴더에 보관 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const form = await req.formData();
    const file = form.get("image");
    const date = String(form.get("date") ?? "");
    if (!(file instanceof File)) throw new HttpError(400, "사진이 없습니다.");

    const { data: comps } = await db().from("companies").select("name, frequent")
      .eq("site_id", site.id).eq("active", true).order("sort_order");
    const companies = (comps ?? []).map((c) => c.name as string);
    const frequent = (comps ?? []).filter((c) => c.frequent).map((c) => c.name as string);

    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/jpeg";

    let page;
    try {
      page = await readPage(bytes.toString("base64"), mimeType, companies, frequent);
    } catch (e) {
      if (e instanceof OcrFailed) return NextResponse.json({ error: e.message }, { status: 502 });
      throw e;
    }
    console.log("[ocr] 결과", JSON.stringify({ site: site.id, date, bytes: bytes.length, rows: page.rows.length, date_text: page.date_text }));
    if (!page.rows.length) {
      return NextResponse.json({
        error: "Gemini가 사진에서 기록을 한 줄도 찾지 못했습니다. 기록지 전체가 보이게, 흔들리지 않게 다시 찍어 주세요."
          + (page.date_text ? ` (읽힌 날짜: ${page.date_text})` : ""),
      }, { status: 422 });
    }

    let imagePath: string | null = null;
    try {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "unknown";
      const path = `site-${site.id}/${day}/${crypto.randomUUID()}.jpg`;
      const { error } = await db().storage.from("scans").upload(path, bytes, { contentType: mimeType });
      if (!error) imagePath = path;
    } catch { /* 사진 보관 실패는 인식 결과에 영향 없음 */ }

    return NextResponse.json({ ...page, imagePath });
  });
}
