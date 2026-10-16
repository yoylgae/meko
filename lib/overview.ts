import { db } from "./supabase";
import { allSites, type Site } from "./access";

export type Row = { site_id: number; report_date: string; seq: number; vehicle_no: string; company: string; out_time: string };

/** 기간 안의 전 현장 반출 내역 (1000행씩 나눠 받아 전부) */
export async function allDispatches(from: string, to: string): Promise<{ sites: Site[]; rows: Row[] }> {
  const sites = await allSites();
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; off < 200_000; off += PAGE) {
    const { data, error } = await db()
      .from("dispatches")
      .select("site_id, report_date, seq, vehicle_no, company, out_time")
      .gte("report_date", from)
      .lte("report_date", to)
      .in("site_id", sites.map((s) => s.id))
      .order("site_id").order("report_date").order("seq")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return { sites, rows };
}
