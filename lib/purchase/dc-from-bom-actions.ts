"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

/**
 * Raise an Out-Processing Delivery Challan from the Material BOM's Processes tab
 * (client 2026-08-21: greige buttons go to a dyer and come back).
 *
 * ## ONE CHALLAN PER CONSIGNMENT, NOT PER ROW
 *
 * Rule 55 makes the challan the document that ACCOMPANIES the goods. Three trim
 * rows going to one dyer on one lorry are one consignment; issuing three
 * challans for one truck is wrong on the facts, triples the return paperwork and
 * inflates the quarterly ITC-04 filing. So this takes a set of process rows,
 * requires them to share a vendor, and writes one header with N lines.
 *
 * That is also why the control is a section-header button rather than a cell: a
 * per-row button structurally cannot produce a multi-line challan.
 *
 * ## IT LIVES HERE AND NOT IN `grn-actions.ts`
 *
 * That file is already 600+ lines of GRN and DC mixed, and this needs Orders
 * context (the amendment) as well as `materials_purchase` write.
 *
 * ## AND IT DOES NOT INHERIT `createDc`'s SWALLOWED ERROR
 *
 * `createDc` logs a failed `dc_line_items` insert to the console and still
 * returns `{ ok: true }`. For a generated challan that would produce a header
 * with no lines and no visible failure — a numbered legal document describing
 * nothing. Here the header is deleted and the error returned.
 */

type Result = { ok: true; dcId: string } | { ok: false; error: string };

const fail = (error: string): Result => ({ ok: false, error });

export async function createDcFromBom(input: {
  amendmentId: string;
  vendorId: string;
  dcDate: string;
  /** Kept for the caller's shape; the DC leaves from the WORKING unit (0788). */
  locationId: string | null;
  rowUids: string[];
  /** Job-work rate per BOM row (row_uid → ₹ per unit sent) — goes on the Process Order. */
  rates?: Record<string, number>;
}): Promise<Result & { dispatched?: boolean; note?: string }> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const { amendmentId, vendorId, dcDate, rowUids, rates = {} } = input;
  if (!rowUids.length) return fail("Nothing selected to send out");
  if (!vendorId) return fail("Pick the processor this material is going to");
  if (!dcDate) return fail("A challan needs a date");

  const s = await createClient();

  /*
   * A PROCESS ORDER IS RAISED WITH IT (0788, user 2026-10-31: "automatically create a
   * Process Order in the background"). One database function writes the issued order (rate,
   * RE, Allowed Loss % from the rows) and a draft Process DC against it, each line tied to
   * its BOM row — so the "already sent" guard still holds — in one transaction.
   */
  const { data: dcId, error } = await s.rpc("bom_process_dc_raise", {
    p_amendment_id: amendmentId,
    p_vendor_id: vendorId,
    p_dc_date: dcDate,
    p_row_uids: rowUids,
    p_rates: rates,
  });
  if (error || !dcId) return fail(error?.message ?? "Could not create the challan");

  /*
   * THEN IT IS DISPATCHED — the goods leave the Material store for the Processing store
   * ("at vendor"). Stock that is not in yet keeps the DC a DRAFT, dispatched later on
   * Stores ▸ Process DC; the order and the challan are kept either way.
   */
  const { error: dispErr } = await s.rpc("process_dc_dispatch", { p_dc_id: dcId });
  const dispatched = !dispErr;

  await writeAudit({
    action: "dc.created_from_bom",
    entityType: "delivery_challans",
    entityId: String(dcId),
    metadata: { amendment_id: amendmentId, lines: rowUids.length, dispatched },
  });

  revalidatePath("/purchase/dc");
  revalidatePath("/stores/process-dc");
  revalidatePath("/stores/process-orders");
  revalidatePath("/orders/material-bom");
  return {
    ok: true,
    dcId: String(dcId),
    dispatched,
    note: dispatched
      ? undefined
      : /Insufficient stock/i.test(dispErr!.message)
        ? "kept as a draft — the Material store does not hold this yet; dispatch it on Stores ▸ Process DC"
        : `kept as a draft — ${dispErr!.message}`,
  };
}
