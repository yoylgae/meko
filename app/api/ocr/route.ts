import { NextRequest, NextResponse } from "next/server";
import { readPage } from "@/lib/gemini";
import { db } from "@/lib/supabase";
import { currentSite, handle, HttpError } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 기록지 사진 1장 → Gemini가 보이는 그대로 읽은 값(정리 전). 원본 사진은 현장 폴더에 보관 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { site } = await currentSite(req);
    const form = await req.formData();
    const file = form.get("image");
    const date = String(form.get("date") ?? "");
    if (!(file instanceof File)) throw new HttpError(400, "사진이 없습니다.");

    const { data: comps } = await db().from("companies").select("name")
      .eq("site_id", site.id).eq("active", true).order("sort_order");
    const companies = (comps ?? []).map((c) => c.name as string);

    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/jpeg";
    const page = await readPage(bytes.toString("base64"), mimeType, companies);

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
