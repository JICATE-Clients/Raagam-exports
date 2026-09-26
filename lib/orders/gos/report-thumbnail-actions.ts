"use server";

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getReportStyleImages, type ReportStyleImage } from "./style-images";
import { pickReportThumbnail } from "./report-thumbnail";

/**
 * THE HEADER THUMBNAIL FOR A REPORT OPENED CLIENT-SIDE (2026-09-26) — the
 * Fabric BOM editor's Reports sheet, which knows its BOM's order only as the
 * `garment_order_amendments` id the report header carries.
 *
 * Loaded BESIDE the report and never merged into it: the report may be a
 * frozen V_final copy, and a signed URL lives an hour (`getReportStyleImages`).
 *
 * NEVER THROWS, and every failure is "no picture": the report is complete
 * without its thumbnail and must still render and print. Unlike the GOS's
 * image block, there is no sentence to show here — a header picture is
 * decoration beside facts that are all still printed.
 */
export async function loadHeaderThumbnail(
  garmentOrderId: string,
  styleRef: string | null,
): Promise<ReportStyleImage | null> {
  try {
    if (!garmentOrderId || !(await can("orders", "view"))) return null;
    const s = await createClient();
    const { data, error } = await s
      .from("garment_order_amendments")
      .select("sales_order_id")
      .eq("id", garmentOrderId)
      .maybeSingle();
    const salesOrderId = (data as { sales_order_id: string | null } | null)?.sales_order_id;
    if (error || !salesOrderId) return null;
    return pickReportThumbnail(await getReportStyleImages(salesOrderId), styleRef);
  } catch {
    return null;
  }
}
