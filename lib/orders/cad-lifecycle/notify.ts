import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";

/**
 * PATTERN READY → THE MERCHANDISER WHO RAISED IT (user 2026-09-25, screenshot
 * 3082: "if the status is Ready it will [be] sent to the raise merchandiser").
 *
 * The CAD Queue no longer sends anything to the buyer. The Pattern Master's
 * last act is setting Ready; this tells the merchandiser, who then sends the
 * CAD to the buyer and records the approval on Order Entry ▸ CAD (user's
 * choice the same day — the Fabric BOM gate and the T&A dates keep working).
 *
 * WHO "RAISED IT": the person who ASSIGNED this CAD version
 * (`order_cad_allocations.created_by`), then the order's merchandiser
 * (`sales_orders.merchandiser_id`), then the merchandising desk
 * (`orders:edit`) — "nobody owns it" must not mean "nobody is told", the rule
 * `notifyMerchandiserOfCadSubmit` already follows.
 *
 * FIRE-AND-FORGET, like `writeAudit`: a failed notification never fails the
 * save that set Ready. The CAD Status on Order Entry shows Ready regardless.
 */
export async function notifyPatternReady(allocationId: string): Promise<void> {
  try {
    const s = await createClient();
    const { data } = await s
      .from("order_cad_allocations")
      .select(
        "style_ref_no, version_no, created_by, " +
          "order:garment_order_amendments!garment_order_id(code, " +
          "sales_order:sales_orders!sales_order_id(order_number, merchandiser_id))",
      )
      .eq("id", allocationId)
      .maybeSingle();
    type One<T> = T | T[] | null;
    const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
    const row = data as unknown as {
      style_ref_no: string;
      version_no: number;
      created_by: string | null;
      order: One<{ code: string | null; sales_order: One<{ order_number: string | null; merchandiser_id: string | null }> }>;
    } | null;
    if (!row) return;
    const order = one(row.order);
    const so = one(order?.sales_order ?? null);
    const reNo = so?.order_number ?? order?.code ?? null;
    const who = row.created_by ?? so?.merchandiser_id ?? null;

    await notify(who ? { userId: who } : { permission: { module: "orders", action: "edit" } }, {
      title: `${reNo ? `Order ${reNo}` : "An order"} · ${row.style_ref_no} — pattern is Ready`,
      body:
        row.version_no > 1
          ? `Version ${row.version_no} of the pattern is ready. Send the CAD to the buyer from Order Entry ▸ CAD.`
          : "The pattern is ready. Send the CAD to the buyer from Order Entry ▸ CAD.",
      href: "/orders/garment-orders",
      type: "success",
    });
  } catch {
    // never breaks the save that set Ready — see the header
  }
}
