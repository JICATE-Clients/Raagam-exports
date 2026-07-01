"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  grnInput,
  grnLineInput,
  dcInput,
  dcLineInput,
  derivePoReceiptStatus,
  type GrnInput,
  type GrnLineInput,
  type DcInput,
  type DcLineInput,
  type PoStatus,
  type DcStatus,
} from "./types";
import { threeWayMatchStatus } from "@/lib/finance/calc";

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

export async function createGrn(payload: GrnInput): Promise<CreateGrnResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = grnInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { lines, ...headerFields } = parsed.data;
  const user = await getAppUser();
  const supabase = await createClient();

  const { data: grn, error } = await supabase
    .from("grns")
    .insert({ ...headerFields, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !grn) {
    return { ok: false, error: error?.message ?? "Failed to create GRN" };
  }

  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("grn_line_items").insert(
      lines.map((l, i) => ({
        ...l,
        grn_id: (grn as { id: string }).id,
        sort_order: l.sort_order ?? i,
      })),
    );
    if (lineErr) {
      console.error("[grn] grn_line_items insert error:", lineErr.message);
    }
  }

  revalidateGrn((grn as { id: string }).id);
  return { ok: true, grnId: (grn as { id: string }).id };
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
 * Post a draft GRN:
 *  1. Validate all rejection_reasons are present when rejected_qty > 0.
 *  2. For each linked PO line with accepted_qty > 0: accumulate received_qty.
 *  3. Mark GRN as posted.
 *  4. For each affected PO: reload lines and derive new receipt status.
 *  5. Write audit entry.
 */
export async function postGrn(grnId: string): Promise<ActionResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // 1. fetch and verify GRN
  const { data: grnData } = await supabase
    .from("grns")
    .select("id, status")
    .eq("id", grnId)
    .maybeSingle();

  if (!grnData) return { ok: false, error: "GRN not found" };
  if ((grnData as { status: string }).status !== "draft") {
    return { ok: false, error: "GRN is already posted" };
  }

  // 2. fetch all lines
  const { data: linesData } = await supabase
    .from("grn_line_items")
    .select(
      "id, po_line_item_id, purchase_order_id, accepted_qty, rejected_qty, rejection_reason",
    )
    .eq("grn_id", grnId);

  const lines = (linesData ?? []) as {
    id: string;
    po_line_item_id: string | null;
    purchase_order_id: string | null;
    accepted_qty: number;
    rejected_qty: number;
    rejection_reason: string | null;
  }[];

  // validate rejection reasons
  for (const line of lines) {
    if ((line.rejected_qty ?? 0) > 0 && !line.rejection_reason?.trim()) {
      return {
        ok: false,
        error: "Rejection reason is required for all lines with rejected quantity",
      };
    }
  }

  // 3. accumulate received_qty on PO lines + collect stock-in movements
  const affectedPoIds = new Set<string>();
  const stockIns: {
    store_type: "material" | "rejection";
    item_id: string;
    qty: number;
  }[] = [];
  const poAccepted = new Map<string, number>(); // poId → accepted value (for payables)

  for (const line of lines) {
    if (!line.po_line_item_id) continue;

    const { data: poLine } = await supabase
      .from("po_line_items")
      .select("received_qty, item_id, unit_price")
      .eq("id", line.po_line_item_id)
      .maybeSingle();

    if (!poLine) continue;
    const pl = poLine as {
      received_qty: number;
      item_id: string | null;
      unit_price: number | null;
    };

    if ((line.accepted_qty ?? 0) > 0) {
      const current = pl.received_qty ?? 0;
      const { error: updateErr } = await supabase
        .from("po_line_items")
        .update({ received_qty: current + line.accepted_qty })
        .eq("id", line.po_line_item_id);

      if (updateErr) {
        return { ok: false, error: `Failed to update PO line: ${updateErr.message}` };
      }
      if (line.purchase_order_id) {
        affectedPoIds.add(line.purchase_order_id);
        poAccepted.set(
          line.purchase_order_id,
          (poAccepted.get(line.purchase_order_id) ?? 0) +
            line.accepted_qty * (pl.unit_price ?? 0),
        );
      }
      // accepted goods → Material store (only when the PO line maps to an item)
      if (pl.item_id) {
        stockIns.push({ store_type: "material", item_id: pl.item_id, qty: line.accepted_qty });
      }
    }

    // rejected goods → Rejection store
    if ((line.rejected_qty ?? 0) > 0 && pl.item_id) {
      stockIns.push({ store_type: "rejection", item_id: pl.item_id, qty: line.rejected_qty });
    }
  }

  // 4. mark GRN posted
  const { error: grnErr } = await supabase
    .from("grns")
    .update({ status: "posted" })
    .eq("id", grnId);

  if (grnErr) return { ok: false, error: grnErr.message };

  // 5. recompute status for each affected PO
  for (const poId of affectedPoIds) {
    const { data: poData } = await supabase
      .from("purchase_orders")
      .select("status")
      .eq("id", poId)
      .maybeSingle();

    if (!poData) continue;

    const currentStatus = (poData as { status: string }).status as PoStatus;

    const { data: poLinesData } = await supabase
      .from("po_line_items")
      .select("quantity, received_qty")
      .eq("purchase_order_id", poId);

    const poLines = (poLinesData ?? []) as {
      quantity: number;
      received_qty: number;
    }[];

    const newStatus = derivePoReceiptStatus(currentStatus, poLines);
    if (newStatus !== currentStatus) {
      await supabase
        .from("purchase_orders")
        .update({ status: newStatus })
        .eq("id", poId);
    }
  }

  // 5b. stock-in: accepted → Material store, rejected → Rejection store.
  // Uses the privileged client because GRN posting is a trusted system action
  // and the posting user may not hold per-store access. The negative-stock
  // trigger still fires, but receipts are inbound so they are always safe.
  // Best-effort: the GRN is already posted, so a stock-in hiccup is not fatal.
  if (stockIns.length > 0) {
    try {
      const admin = createAdminClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: storeRows } = await admin
        .from("stores")
        .select("id, store_type")
        .in("store_type", ["material", "rejection"]);
      const storeByType = new Map(
        ((storeRows ?? []) as { id: string; store_type: string }[]).map((s) => [
          s.store_type,
          s.id,
        ]),
      );
      const movements = stockIns
        .map((m) => {
          const storeId = storeByType.get(m.store_type);
          if (!storeId) return null;
          return {
            store_id: storeId,
            item_id: m.item_id,
            movement_type: "receipt",
            quantity: m.qty,
            reference_type: "grn",
            reference_id: grnId,
            note: `GRN stock-in (${m.store_type})`,
            created_by: user?.id ?? null,
          };
        })
        .filter(Boolean) as Record<string, unknown>[];
      if (movements.length > 0) {
        await admin.from("stock_ledger").insert(movements);
      }
    } catch {
      // stock-in is best-effort; GRN remains posted
    }
  }

  // 5c. GRN → draft vendor bills (Finance). One draft payable per PO covered by
  // this GRN, valued at accepted qty × PO unit price, with a 3-way match status.
  // Admin client (the posting user may lack finance perms). Best-effort.
  if (poAccepted.size > 0) {
    try {
      const admin = createAdminClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      for (const [poId, amount] of poAccepted) {
        if (amount <= 0) continue;
        const { data: po } = await admin
          .from("purchase_orders")
          .select("vendor_id, currency_code, total_amount, location_id")
          .eq("id", poId)
          .maybeSingle();
        const poRow = po as {
          vendor_id: string | null;
          currency_code: string | null;
          total_amount: number | null;
          location_id: string | null;
        } | null;
        const matchStatus = threeWayMatchStatus(
          amount,
          poRow?.total_amount ?? null,
          amount,
        );
        await admin.from("payables").insert({
          vendor_id: poRow?.vendor_id ?? null,
          purchase_order_id: poId,
          grn_id: grnId,
          currency_code: poRow?.currency_code ?? null,
          amount,
          tax_amount: 0,
          total_amount: amount,
          match_status: matchStatus,
          status: "draft",
          location_id: poRow?.location_id ?? null,
          created_by: user?.id ?? null,
        });
      }
      revalidatePath("/finance/payables");
    } catch {
      // best-effort payable creation
    }
  }

  // 6. audit
  await writeAudit({
    action: "grn.posted",
    entityType: "grn",
    entityId: grnId,
  });

  // 7. revalidate paths including purchase orders list + stores
  revalidateGrn(grnId);
  revalidatePath("/purchase/orders");
  revalidatePath("/stores");

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
