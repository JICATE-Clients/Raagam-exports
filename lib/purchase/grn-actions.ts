"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  grnInput,
  grnLineInput,
  dcInput,
  dcLineInput,
  type GrnInput,
  type GrnLineInput,
  type DcInput,
  type DcLineInput,
  type DcStatus,
} from "./types";
import { acceptedFrom, receiptBand } from "./grn-tolerance";
import { getGrnReceivingLocations } from "./grn-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateGrnResult = { ok: true; grnId: string } | ErrResult;
type CreateDcResult = { ok: true; dcId: string } | ErrResult;

function revalidateGrn(grnId: string): void {
  revalidatePath(`/purchase/grn/${grnId}`);
  revalidatePath("/purchase/grn");
  revalidatePath("/purchase");
}

function revalidateDc(dcId: string): void {
  revalidatePath(`/purchase/dc/${dcId}`);
  revalidatePath("/purchase/dc");
  revalidatePath("/purchase");
}

// ---------- GRN ----------

/** The database's tolerance refusal (0620), said the way the screen says it. */
const OVER_TOLERANCE_MSG =
  "One or more lines exceed the PO's over-receipt tolerance. A Store Manager must authorise the over-receipt before this GRN can be saved.";

function friendlyGrnError(message: string): string {
  return /tolerance/i.test(message) ? OVER_TOLERANCE_MSG : message;
}

export async function createGrn(payload: GrnInput): Promise<CreateGrnResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = grnInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { lines: rawLines, over_receipt_reason, ...headerFields } = parsed.data;
  if (rawLines.length === 0) {
    return { ok: false, error: "Enter Today Recd on at least one line" };
  }

  /* ACCEPTED IS DERIVED, never typed (0620): Today Recd - Shortage / Rej. The
     screen computes it the same way; recomputing here is what keeps a stale or
     hand-crafted payload from posting more into stock than was counted. */
  const lines = rawLines.map((l) => ({
    ...l,
    accepted_qty: acceptedFrom(l.received_qty, l.rejected_qty),
  }));
  for (const l of lines) {
    if (l.rejected_qty > l.received_qty) {
      return { ok: false, error: `${l.description}: Shortage / Rej cannot exceed Today Recd` };
    }
  }

  /* UNIT ISOLATION. `grns_insert` already refuses any unit but the one the
     operator is working in (is_current_location, 0487); saying so here turns an
     RLS "violates row-level security policy" into a sentence. */
  const receiving = await getGrnReceivingLocations();
  const locationId = headerFields.location_id ?? receiving.defaultId;
  if (!locationId || !receiving.options.some((o) => o.id === locationId && o.postable)) {
    return {
      ok: false,
      error: "A GRN is received into the unit you are working in. Switch unit in the top bar first.",
    };
  }

  const supabase = await createClient();
  const user = await getAppUser();

  /* OVER-RECEIPT TOLERANCE, SERVER SIDE. Same rule as the screen
     (grn-tolerance.ts) and as the database trigger that backs both (0620). */
  const poLineIds = Array.from(
    new Set(lines.map((l) => l.po_line_item_id).filter(Boolean)),
  ) as string[];
  let overCount = 0;
  if (poLineIds.length > 0) {
    const { data: plData, error: plErr } = await supabase
      .from("po_line_items")
      .select("id, quantity, received_qty, purchase_orders!purchase_order_id(over_receipt_tolerance_pct)")
      .in("id", poLineIds);
    if (plErr) return { ok: false, error: plErr.message };
    const byId = new Map(
      (
        (plData ?? []) as unknown as {
          id: string;
          quantity: number;
          received_qty: number;
          purchase_orders: { over_receipt_tolerance_pct: number | null } | null;
        }[]
      ).map((r) => [r.id, r]),
    );
    const todayByLine = new Map<string, number>();
    for (const l of lines) {
      if (!l.po_line_item_id) continue;
      todayByLine.set(l.po_line_item_id, (todayByLine.get(l.po_line_item_id) ?? 0) + l.accepted_qty);
    }
    for (const [id, today] of todayByLine) {
      const pl = byId.get(id);
      if (!pl) return { ok: false, error: "A PO line on this GRN no longer exists" };
      const band = receiptBand({
        ordered: Number(pl.quantity) || 0,
        receivedSoFar: Number(pl.received_qty) || 0,
        acceptedToday: today,
        tolerancePct: Number(pl.purchase_orders?.over_receipt_tolerance_pct ?? 3),
      });
      if (band === "over") overCount++;
    }
  }

  /* THE PO LINES SAY WHAT WAS BOUGHT, AND FROM WHOM (0777). The item is copied from the
     PO line — never taken from the payload — and every PO on the GRN must name the GRN's
     vendor: one GRN is one vendor's delivery, as one PO is one vendor's order. */
  const itemByLine = new Map<string, string | null>();
  /** Per PO line: ordered − short-closed − received so far (0780). */
  const stillOrdered = new Map<string, number>();
  if (poLineIds.length > 0) {
    const { data: plRows, error: plRowsErr } = await supabase
      .from("po_line_items")
      .select("id, item_id, quantity, received_qty, closed_qty, purchase_orders!purchase_order_id(master_vendor_id)")
      .in("id", poLineIds);
    if (plRowsErr) return { ok: false, error: plRowsErr.message };
    for (const r of (plRows ?? []) as unknown as {
      id: string;
      item_id: string | null;
      quantity: number;
      received_qty: number;
      closed_qty: number;
      purchase_orders: { master_vendor_id: string | null } | null;
    }[]) {
      stillOrdered.set(r.id, (Number(r.quantity) || 0) - (Number(r.closed_qty) || 0) - (Number(r.received_qty) || 0));
      if (r.purchase_orders?.master_vendor_id !== headerFields.master_vendor_id) {
        return { ok: false, error: "A PO on this GRN is from a different vendor — receive each vendor's goods on its own GRN" };
      }
      itemByLine.set(r.id, r.item_id);
    }
  }
  for (const l of lines) l.item_id = l.po_line_item_id ? (itemByLine.get(l.po_line_item_id) ?? null) : null;

  /* A REPLACEMENT GRN (0780) receives only what its Rejection DC still owes: the same
     vendor, the DC's own "replace" lines, no more than is outstanding on each. Its own
     rejections stay owed on the same DC, so they are always "replace". */
  if (headerFields.kind === "replacement") {
    if (!headerFields.vendor_return_id) return { ok: false, error: "Pick the Rejection DC this replaces" };
    const { data: dc, error: dcErr } = await supabase
      .from("vendor_returns")
      .select("id, grn_id, master_vendor_id, status")
      .eq("id", headerFields.vendor_return_id)
      .maybeSingle();
    if (dcErr) return { ok: false, error: dcErr.message };
    const d = dc as { grn_id: string | null; master_vendor_id: string | null; status: string } | null;
    if (!d || !d.grn_id) return { ok: false, error: "That Rejection DC was not raised by a GRN" };
    if (d.master_vendor_id !== headerFields.master_vendor_id) {
      return { ok: false, error: "The replacement must come from the vendor the goods were returned to" };
    }
    if (!["draft", "returned"].includes(d.status)) return { ok: false, error: "That Rejection DC is already settled" };
    const { data: dcLines, error: dlErr } = await supabase
      .from("vendor_return_lines")
      .select("po_line_item_id, return_qty, replacement_qty, rejection_action")
      .eq("vendor_return_id", headerFields.vendor_return_id);
    if (dlErr) return { ok: false, error: dlErr.message };
    const due = new Map<string, number>();
    for (const r of (dcLines ?? []) as {
      po_line_item_id: string | null;
      return_qty: number;
      replacement_qty: number;
      rejection_action: string | null;
    }[]) {
      if (!r.po_line_item_id || (r.rejection_action ?? "replace") !== "replace") continue;
      due.set(r.po_line_item_id, (due.get(r.po_line_item_id) ?? 0) + (Number(r.return_qty) || 0) - (Number(r.replacement_qty) || 0));
    }
    for (const l of lines) {
      const owed = l.po_line_item_id ? due.get(l.po_line_item_id) : undefined;
      if (owed === undefined) return { ok: false, error: `${l.description}: not on that Rejection DC` };
      if (l.accepted_qty > owed + 1e-9) {
        return { ok: false, error: `${l.description}: only ${owed} is owed as a replacement` };
      }
      l.rejection_action = "replace";
    }
  } else {
    headerFields.vendor_return_id = null;
    /* GOODS OWED AS A REPLACEMENT ARE NOT RECEIVED AS AN ORDINARY GRN (0780). The vendor's
       original invoice already covered them, so receiving them here would raise a second
       bill and leave the Rejection DC owed for ever. What a line may take is what is still
       ordered MINUS what is owed back on an open Rejection DC; the rest is received on the
       DC's own row (a Replacement GRN). */
    if (poLineIds.length > 0) {
      const { data: owedRows, error: owedErr } = await supabase
        .from("vendor_return_lines")
        .select("po_line_item_id, return_qty, replacement_qty, rejection_action, vendor_returns!inner(code, status, grn_id)")
        .in("po_line_item_id", poLineIds)
        .in("vendor_returns.status", ["draft", "returned"])
        .not("vendor_returns.grn_id", "is", null);
      if (owedErr) return { ok: false, error: owedErr.message };
      const owed = new Map<string, { qty: number; dc: string }>();
      for (const r of (owedRows ?? []) as unknown as {
        po_line_item_id: string;
        return_qty: number;
        replacement_qty: number;
        rejection_action: string | null;
        vendor_returns: { code: string | null } | null;
      }[]) {
        if ((r.rejection_action ?? "replace") !== "replace") continue;
        const due = (Number(r.return_qty) || 0) - (Number(r.replacement_qty) || 0);
        if (due <= 0) continue;
        const cur = owed.get(r.po_line_item_id);
        owed.set(r.po_line_item_id, { qty: (cur?.qty ?? 0) + due, dc: r.vendor_returns?.code ?? cur?.dc ?? "a Rejection DC" });
      }
      for (const l of lines) {
        const o = l.po_line_item_id ? owed.get(l.po_line_item_id) : undefined;
        if (!o) continue;
        const room = Math.max(0, (stillOrdered.get(l.po_line_item_id!) ?? 0) - o.qty);
        if (l.accepted_qty > room + 1e-9) {
          return {
            ok: false,
            error: `${l.description}: ${o.qty} of it is owed as a replacement on ${o.dc} — receive that on its row under Pending; this GRN can take ${room}`,
          };
        }
      }
    }
  }

  /* A LINE'S STORE IS ONE OF THE GRN'S OWN UNIT (unit isolation, 2026-10-03): goods
     received into Unit 2 are never booked into Head Office's store. */
  const storeIds = Array.from(new Set(lines.map((l) => l.store_id).filter(Boolean))) as string[];
  if (storeIds.length > 0) {
    const { data: stRows, error: stErr } = await supabase.from("stores").select("id, location_id").in("id", storeIds);
    if (stErr) return { ok: false, error: stErr.message };
    const own = new Set(((stRows ?? []) as { id: string; location_id: string | null }[]).filter((r) => r.location_id === locationId).map((r) => r.id));
    if (storeIds.some((id) => !own.has(id))) {
      return { ok: false, error: "A line's store is not in the unit you are receiving into — pick one of this unit's stores" };
    }
  }

  const override: Record<string, unknown> = {};
  if (overCount > 0) {
    if (!over_receipt_reason) return { ok: false, error: OVER_TOLERANCE_MSG };
    // `stores:approve` is the Store Manager key (Manager holds it, Store Keeper
    // does not). The CALLER is stamped as the authoriser, never a client id,
    // and the database trigger refuses anything else (0620).
    if (!user || !(await can("stores", "approve"))) {
      return {
        ok: false,
        error: "Only a Store Manager (Stores: Approve) can authorise an over-receipt.",
      };
    }
    override.over_receipt_authorized_by = user.id;
    override.over_receipt_reason = over_receipt_reason;
  }

  const { data: grn, error } = await supabase
    .from("grns")
    .insert({
      ...headerFields,
      location_id: locationId,
      ...override,
      status: "draft",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !grn) {
    return { ok: false, error: friendlyGrnError(error?.message ?? "Failed to create GRN") };
  }
  const grnId = (grn as { id: string }).id;

  const { error: lineErr } = await supabase.from("grn_line_items").insert(
    lines.map((l, i) => ({
      ...l,
      grn_id: grnId,
      sort_order: l.sort_order ?? i,
    })),
  );
  if (lineErr) {
    /* A GRN WITHOUT ITS LINES IS NOT A SAVE. This used to log and return ok,
       which left an empty draft and told the keeper it had worked. Now that the
       database refuses an over-tolerance line, that silence would be the whole
       failure mode, so the header goes too and the reason reaches the screen. */
    await supabase.from("grns").delete().eq("id", grnId);
    return { ok: false, error: friendlyGrnError(lineErr.message) };
  }

  revalidateGrn(grnId);
  return { ok: true, grnId };
}

export async function addGrnLine(
  grnId: string,
  data: GrnLineInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = grnLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // verify GRN is still draft
  const { data: grn } = await supabase
    .from("grns")
    .select("status")
    .eq("id", grnId)
    .maybeSingle();
  if (!grn) return { ok: false, error: "GRN not found" };
  if ((grn as { status: string }).status !== "draft") {
    return { ok: false, error: "Cannot edit a posted GRN" };
  }

  const { error } = await supabase
    .from("grn_line_items")
    .insert({ ...parsed.data, grn_id: grnId });

  if (error) return { ok: false, error: error.message };

  revalidateGrn(grnId);
  return { ok: true };
}

export async function updateGrnLine(
  lineId: string,
  data: GrnLineInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = grnLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // look up grn_id then verify draft status separately
  const { data: lineRow } = await supabase
    .from("grn_line_items")
    .select("grn_id")
    .eq("id", lineId)
    .maybeSingle();

  if (!lineRow) return { ok: false, error: "Line not found" };
  const grnId = (lineRow as { grn_id: string }).grn_id;

  const { data: grnRow } = await supabase
    .from("grns")
    .select("status")
    .eq("id", grnId)
    .maybeSingle();

  if ((grnRow as { status: string } | null)?.status !== "draft") {
    return { ok: false, error: "Cannot edit a posted GRN" };
  }

  const { error } = await supabase
    .from("grn_line_items")
    .update({ ...parsed.data })
    .eq("id", lineId);

  if (error) return { ok: false, error: error.message };

  revalidateGrn(grnId);
  return { ok: true };
}

export async function deleteGrnLine(lineId: string): Promise<ActionResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: lineRow } = await supabase
    .from("grn_line_items")
    .select("grn_id")
    .eq("id", lineId)
    .maybeSingle();

  if (!lineRow) return { ok: false, error: "Line not found" };
  const grnId = (lineRow as { grn_id: string }).grn_id;

  const { data: grnRow } = await supabase
    .from("grns")
    .select("status")
    .eq("id", grnId)
    .maybeSingle();

  if ((grnRow as { status: string } | null)?.status !== "draft") {
    return { ok: false, error: "Cannot edit a posted GRN" };
  }

  const { error } = await supabase
    .from("grn_line_items")
    .delete()
    .eq("id", lineId);

  if (error) return { ok: false, error: error.message };

  revalidateGrn(grnId);
  return { ok: true };
}

/**
 * POST A DRAFT GRN — ONE TRANSACTION (0779, grn-plan.md Phase 3).
 *
 * `grn_post()` does every step in the database, in one statement: the 0620 tolerance
 * guard, received qty onto the PO lines, each PO's receipt status, stock into the line's
 * store and BIN (rejected → the unit's Rejection store), and one draft bill per PO. Any
 * step that fails undoes them all and the GRN stays a draft. This used to be eight
 * requests from here, posting the GRN FIRST and swallowing stock / bill errors — so a
 * GRN could read Posted with no stock behind it.
 */
export async function postGrn(grnId: string): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase.rpc("grn_post", { p_grn_id: grnId });
  if (error) return { ok: false, error: friendlyGrnError(error.message) };

  await writeAudit({
    action: "grn.posted",
    entityType: "grn",
    entityId: grnId,
  });

  revalidateGrn(grnId);
  revalidatePath("/purchase/orders");
  revalidatePath("/stores");
  revalidatePath("/finance/payables");

  return { ok: true };
}

// ---------- DC ----------

export async function createDc(payload: DcInput): Promise<CreateDcResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = dcInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { lines, ...headerFields } = parsed.data;
  const user = await getAppUser();
  const supabase = await createClient();

  const { data: dc, error } = await supabase
    .from("delivery_challans")
    .insert({
      ...headerFields,
      status: "issued",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !dc) {
    return { ok: false, error: error?.message ?? "Failed to create DC" };
  }

  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("dc_line_items").insert(
      lines.map((l, i) => ({
        ...l,
        delivery_challan_id: (dc as { id: string }).id,
        returned_qty: 0,
        sort_order: l.sort_order ?? i,
      })),
    );
    if (lineErr) {
      console.error("[dc] dc_line_items insert error:", lineErr.message);
    }
  }

  revalidateDc((dc as { id: string }).id);
  return { ok: true, dcId: (dc as { id: string }).id };
}

export async function addDcLine(
  dcId: string,
  data: DcLineInput,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = dcLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  const { data: dc } = await supabase
    .from("delivery_challans")
    .select("status")
    .eq("id", dcId)
    .maybeSingle();
  if (!dc) return { ok: false, error: "DC not found" };
  if ((dc as { status: string }).status === "closed") {
    return { ok: false, error: "Cannot add lines to a closed DC" };
  }

  const { error } = await supabase.from("dc_line_items").insert({
    ...parsed.data,
    delivery_challan_id: dcId,
    returned_qty: 0,
  });

  if (error) return { ok: false, error: error.message };

  revalidateDc(dcId);
  return { ok: true };
}

/**
 * Record a material return for a DC line.
 * Increments returned_qty (capped at sent_qty) then recomputes DC status:
 *  - all lines fully returned → 'closed'
 *  - some lines partially returned → 'partially_returned'
 *  - none returned → 'issued'
 */
export async function recordDcReturn(
  lineId: string,
  qty: number,
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  if (qty <= 0) return { ok: false, error: "Return quantity must be positive" };

  const supabase = await createClient();

  const { data: lineData } = await supabase
    .from("dc_line_items")
    .select("id, delivery_challan_id, sent_qty, returned_qty")
    .eq("id", lineId)
    .maybeSingle();

  if (!lineData) return { ok: false, error: "DC line not found" };

  const line = lineData as {
    id: string;
    delivery_challan_id: string;
    sent_qty: number;
    returned_qty: number;
  };
  const newReturned = Math.min(
    line.sent_qty,
    (line.returned_qty ?? 0) + qty,
  );

  const { error: updateErr } = await supabase
    .from("dc_line_items")
    .update({ returned_qty: newReturned })
    .eq("id", lineId);

  if (updateErr) return { ok: false, error: updateErr.message };

  // re-fetch all lines to compute DC status
  const { data: freshLinesData } = await supabase
    .from("dc_line_items")
    .select("sent_qty, returned_qty")
    .eq("delivery_challan_id", line.delivery_challan_id);

  const fresh = (freshLinesData ?? []) as {
    sent_qty: number;
    returned_qty: number;
  }[];

  let newStatus: DcStatus;
  if (fresh.length === 0) {
    newStatus = "issued";
  } else if (fresh.every((l) => (l.returned_qty ?? 0) >= l.sent_qty)) {
    newStatus = "closed";
  } else if (fresh.some((l) => (l.returned_qty ?? 0) > 0)) {
    newStatus = "partially_returned";
  } else {
    newStatus = "issued";
  }

  const { error: statusErr } = await supabase
    .from("delivery_challans")
    .update({ status: newStatus })
    .eq("id", line.delivery_challan_id);

  if (statusErr) return { ok: false, error: statusErr.message };

  revalidateDc(line.delivery_challan_id);
  return { ok: true };
}

/**
 * SET A DRAFT LINE'S REJECTION — and nothing else (grn-plan.md Phase 4).
 *
 * The one edit a draft GRN needs after a quality check fails the goods: how many are
 * rejected, why, and where they go. Accepted is re-derived (Received − Rejected), never
 * typed, exactly as on save; a replacement GRN's rejection is always "replace" (still owed
 * on the same DC). `updateGrnLine` rewrites the whole row from the payload, which is the
 * wrong tool for a two-field correction.
 */
export async function setGrnLineRejection(
  lineId: string,
  input: { rejected_qty: number; rejection_reason: string | null; rejection_action: "replace" | "return" },
): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("grn_line_items")
    .select("grn_id, received_qty, grns!grn_id(status, kind)")
    .eq("id", lineId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const r = row as unknown as { grn_id: string; received_qty: number; grns: { status: string; kind: string } | null } | null;
  if (!r) return { ok: false, error: "Line not found" };
  if (r.grns?.status !== "draft") return { ok: false, error: "Cannot edit a posted GRN" };
  const received = Number(r.received_qty) || 0;
  const rejected = Number(input.rejected_qty) || 0;
  if (rejected < 0 || rejected > received) return { ok: false, error: "Rejected must be between 0 and the qty received" };
  const reason = input.rejection_reason?.trim() || null;
  if (rejected > 0 && !reason) return { ok: false, error: "Say why the goods are rejected" };
  const { error: upErr } = await supabase
    .from("grn_line_items")
    .update({
      rejected_qty: rejected,
      accepted_qty: acceptedFrom(received, rejected),
      rejection_reason: rejected > 0 ? reason : null,
      rejection_action: r.grns?.kind === "replacement" ? "replace" : input.rejection_action,
    })
    .eq("id", lineId);
  if (upErr) return { ok: false, error: friendlyGrnError(upErr.message) };
  revalidateGrn(r.grn_id);
  return { ok: true };
}
