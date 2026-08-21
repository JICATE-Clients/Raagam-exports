"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
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
  locationId: string | null;
  rowUids: string[];
}): Promise<Result> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const { amendmentId, vendorId, dcDate, locationId, rowUids } = input;
  if (!rowUids.length) return fail("Nothing selected to send out");
  if (!vendorId) return fail("Pick the processor this material is going to");
  if (!dcDate) return fail("A challan needs a date");

  const s = await createClient();

  const { data: rows, error: rowErr } = await s
    .from("material_bom_amendment_processes")
    .select(
      "row_uid, item_id, vendor_id, qty_out, process:processes(name), item:items(id, name)",
    )
    .eq("amendment_id", amendmentId)
    .in("row_uid", rowUids);
  if (rowErr) return fail(rowErr.message);

  type Row = {
    row_uid: string;
    item_id: string | null;
    vendor_id: string | null;
    qty_out: number | null;
    process: { name: string | null } | { name: string | null }[] | null;
    item: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  const picked = (rows ?? []) as unknown as Row[];
  if (picked.length !== rowUids.length) {
    // A row vanished between the screen reading it and this running — a parallel
    // save, most likely. Refuse rather than raise a challan for a subset the
    // operator did not choose.
    return fail("Some of those lines are no longer on the BOM — reopen it and try again");
  }

  for (const r of picked) {
    if (!r.item_id) return fail("Every line sent out must name a material");
    if (!(Number(r.qty_out) > 0)) return fail("Every line sent out must have a Qty Out");
    if (r.vendor_id !== vendorId) {
      return fail("All lines on one challan must go to the same processor");
    }
  }

  /*
   * ALREADY SENT? The partial unique index is the real guard and would refuse the
   * insert anyway, but a `23505` reaches the operator as a database error. This
   * turns it into a sentence, and it is a genuine race rather than a formality:
   * two operators on one BOM, or a double-clicked button.
   */
  const { data: already } = await s
    .from("dc_line_items")
    .select("mba_process_row_uid")
    .in("mba_process_row_uid", rowUids);
  if ((already ?? []).length > 0) {
    return fail("One of those lines already has a challan — reopen the BOM to see it");
  }

  /*
   * `purpose` NAMES THE PROCESSES ON THIS CHALLAN, joined where a consignment
   * carries more than one. A single process name would be a lie on a mixed
   * challan, and 0008's own column comment gives exactly these examples
   * ("Button Coloring, Knitting, Dyeing").
   */
  const purposes = [
    ...new Set(picked.map((r) => one(r.process)?.name).filter((v): v is string => !!v)),
  ];
  const purpose = purposes.length ? purposes.join(" · ") : "Job work";

  const user = await getAppUser();

  const { data: dc, error } = await s
    .from("delivery_challans")
    .insert({
      vendor_id: vendorId,
      location_id: locationId,
      dc_date: dcDate,
      purpose,
      status: "issued",
      created_by: user?.id ?? null,
    })
    .select("id, code")
    .single();

  if (error || !dc) return fail(error?.message ?? "Could not create the challan");
  const dcId = (dc as { id: string }).id;

  const { error: lineErr } = await s.from("dc_line_items").insert(
    picked.map((r, i) => ({
      delivery_challan_id: dcId,
      item_id: r.item_id,
      // NOT NULL, and it is what the challan PRINTS — so it names the material
      // and what is being done to it, not just an id.
      description: `${one(r.item)?.name ?? "Material"} — ${one(r.process)?.name ?? "Job work"}`,
      sent_qty: Number(r.qty_out),
      returned_qty: 0,
      sort_order: i,
      mba_amendment_id: amendmentId,
      mba_process_row_uid: r.row_uid,
    })),
  );

  if (lineErr) {
    /*
     * ROLL THE HEADER BACK. `createDc` logs this and returns ok, which leaves a
     * numbered challan describing nothing — and DC numbers come from a sequence,
     * so the gap is permanent. Two statements are not a transaction, but deleting
     * an empty header is the recoverable half.
     */
    await s.from("delivery_challans").delete().eq("id", dcId);
    return fail(`Could not write the challan lines: ${lineErr.message}`);
  }

  await writeAudit({
    action: "dc.created_from_bom",
    entityType: "delivery_challans",
    entityId: dcId,
    locationId,
    metadata: { amendment_id: amendmentId, lines: picked.length, purpose },
  });

  revalidatePath("/purchase/dc");
  revalidatePath(`/purchase/dc/${dcId}`);
  revalidatePath("/orders/material-bom");
  return { ok: true, dcId };
}
