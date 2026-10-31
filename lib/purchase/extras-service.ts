import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  PurchaseIndent,
  PurchaseIndentLine,
  OverBudgetConfirmation,
  PoRateAmendment,
  PoCancellation,
  PoCancelRequest,
  LabTestStandard,
  LabTest,
} from "./extras-types";
import { withCreators } from "@/lib/created-by";

// reuse existing purchase pickers
export { getVendorsForPicker, getItems, getUoms, listPurchaseOrders } from "./po-service";
export type { VendorForPicker, PoWithVendor } from "./po-service";

export type OrderOption = { id: string; order_number: string | null };
export type BuyerOption = { id: string; name: string };
export type PoOption = { id: string; code: string | null; vendor_name: string | null };
export type PoLineOption = { id: string; description: string; unit_price: number };
export type PoWithLines = PoOption & { lines: PoLineOption[] };

function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

export async function getOrders(): Promise<OrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number")
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderOption[];
}
export async function getBuyers(): Promise<BuyerOption[]> {
  const s = await createClient();
  const { data } = await s.from("buyers").select("id, name").order("name");
  return (data ?? []) as BuyerOption[];
}

/** Light PO picker (code + vendor). */
export async function getPoOptions(): Promise<PoOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, vendors!vendor_id(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    vendor_name: joined(r, "vendors", "name"),
  }));
}

/** POs with their line items, for the rate-amendment picker. */
export async function getPosWithLines(): Promise<PoWithLines[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, vendors!vendor_id(name), po_line_items(id, description, unit_price, sort_order)")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const lines = ((r.po_line_items ?? []) as Record<string, unknown>[])
      .map((l) => ({
        id: l.id as string,
        description: l.description as string,
        unit_price: (l.unit_price as number) ?? 0,
        sort_order: (l.sort_order as number) ?? 0,
      }))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, description, unit_price }) => ({ id, description, unit_price }));
    return {
      id: r.id as string,
      code: (r.code as string | null) ?? null,
      vendor_name: joined(r, "vendors", "name"),
      lines,
    };
  });
}

/** DRAFT POs — the only ones cancelled directly (0785); the rest go by request. */
export async function getCancellablePos(): Promise<PoOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, master_vendor:master_vendors!master_vendor_id(name), vendors!vendor_id(name)")
    .eq("status", "draft")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    vendor_name: joined(r, "master_vendor", "name") ?? joined(r, "vendors", "name"),
  }));
}

// ============================================================================
// Purchase Indents
// ============================================================================
export interface PurchaseIndentWithRefs extends PurchaseIndent {
  order_number: string | null;
}
export async function listPurchaseIndents(): Promise<PurchaseIndentWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_indents")
    .select("*, sales_orders(order_number)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PurchaseIndent),
    order_number: joined(r, "sales_orders", "order_number"),
  })));
}
export async function getPurchaseIndent(id: string): Promise<PurchaseIndent | null> {
  const s = await createClient();
  const { data } = await s.from("purchase_indents").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as PurchaseIndent | null;
}
export async function getIndentLines(indentId: string): Promise<PurchaseIndentLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_indent_lines")
    .select("*")
    .eq("purchase_indent_id", indentId)
    .order("sort_order");
  return (data ?? []) as PurchaseIndentLine[];
}

// ============================================================================
// Over-budget confirmations
// ============================================================================
export interface OverBudgetWithRefs extends OverBudgetConfirmation {
  po_code: string | null;
}
export async function listOverBudget(): Promise<OverBudgetWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("over_budget_confirmations")
    .select("*, purchase_orders(code)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OverBudgetConfirmation),
    po_code: joined(r, "purchase_orders", "code"),
  })));
}

// ============================================================================
// PO rate amendments
// ============================================================================
export interface RateAmendmentWithRefs extends PoRateAmendment {
  po_code: string | null;
}
export async function listRateAmendments(): Promise<RateAmendmentWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("po_rate_amendments")
    .select("*, purchase_orders(code)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PoRateAmendment),
    po_code: joined(r, "purchase_orders", "code"),
  })));
}

// ============================================================================
// PO cancellations
// ============================================================================
export interface PoCancellationWithRefs extends PoCancellation {
  po_code: string | null;
  vendor_name: string | null;
}
export async function listPoCancellations(): Promise<PoCancellationWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("po_cancellations")
    .select("*, purchase_orders(code, vendors!vendor_id(name))")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => {
    const po = r.purchase_orders as Record<string, unknown> | null;
    const vendor = po?.vendors as Record<string, unknown> | null;
    return {
      ...(r as unknown as PoCancellation),
      po_code: (po?.code as string | null) ?? null,
      vendor_name: (vendor?.name as string | null) ?? null,
    };
  }));
}

// ============================================================================
// PO cancellation requests (0785) — whole PO or chosen lines, through My Approvals
// ============================================================================
/** One PO line as the request grid needs it: what is still open to cancel. */
export type CancellableLine = {
  id: string;
  description: string;
  uom_code: string | null;
  /** Ordered now (already net of earlier cancellations). */
  quantity: number;
  received_qty: number;
  cancelled_qty: number;
  /** quantity − received − rejection short-close − closed balance. */
  open_qty: number;
};
export type CancellablePo = PoOption & { status: string; lines: CancellableLine[] };

/**
 * POs a cancellation REQUEST can be raised on — approved or partly received, with
 * something still open, and no request already waiting. A draft is cancelled
 * directly; a PO waiting for approval is rejected on its own page.
 */
export async function getPosForCancelRequest(): Promise<CancellablePo[]> {
  const s = await createClient();
  const [{ data, error }, { data: open, error: oErr }] = await Promise.all([
    s
      .from("purchase_orders")
      .select(
        "id, code, status, master_vendor:master_vendors!master_vendor_id(name), vendors!vendor_id(name), " +
          "po_line_items(id, description, quantity, received_qty, closed_qty, balance_closed_qty, cancelled_qty, sort_order, uoms!uom_id(code))",
      )
      .in("status", ["approved", "partially_received"])
      .order("created_at", { ascending: false }),
    s.from("po_cancellation_requests").select("purchase_order_id").eq("status", "submitted"),
  ]);
  if (error) throw new Error(error.message);
  if (oErr) throw new Error(oErr.message);
  const waiting = new Set(((open ?? []) as { purchase_order_id: string }[]).map((r) => r.purchase_order_id));
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => !waiting.has(r.id as string))
    .map((r) => {
      const lines = ((r.po_line_items ?? []) as Record<string, unknown>[])
        .map((l) => {
          const q = Number(l.quantity) || 0;
          const rec = Number(l.received_qty) || 0;
          const open = Math.max(q - rec - (Number(l.closed_qty) || 0) - (Number(l.balance_closed_qty) || 0), 0);
          return {
            id: l.id as string,
            description: (l.description as string) ?? "",
            uom_code: ((l.uoms as Record<string, unknown> | null)?.code as string | null) ?? null,
            quantity: q,
            received_qty: rec,
            cancelled_qty: Number(l.cancelled_qty) || 0,
            open_qty: Math.round(open * 1000) / 1000,
            sort: Number(l.sort_order) || 0,
          };
        })
        .sort((a, b) => a.sort - b.sort)
        .map(({ sort: _sort, ...l }) => l);
      return {
        id: r.id as string,
        code: (r.code as string | null) ?? null,
        status: r.status as string,
        vendor_name: joined(r, "master_vendor", "name") ?? joined(r, "vendors", "name"),
        lines,
      };
    })
    .filter((p) => p.lines.some((l) => l.open_qty > 0));
}

export type PoCancelRequestRow = PoCancelRequest & {
  po_code: string | null;
  vendor_name: string | null;
  lines: { po_line_item_id: string; description: string; cancel_qty: number; open_qty: number; uom_code: string | null }[];
};

export async function listPoCancelRequests(): Promise<PoCancelRequestRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("po_cancellation_requests")
    .select(
      "id, code, purchase_order_id, scope, reason, status, decided_by, decided_at, decision_remark, created_by, created_at, " +
        "purchase_orders(code, master_vendor:master_vendors!master_vendor_id(name), vendors!vendor_id(name)), " +
        "po_cancellation_request_lines(po_line_item_id, cancel_qty, open_qty, sort_order, po_line_items(description, uoms!uom_id(code)))",
    )
    // LISTED IN ENTRY ORDER (user 2026-09-22).
    .order("created_at", { ascending: true });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (error) throw new Error(error.message);
  return withCreators(
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const po = (r.purchase_orders ?? null) as Record<string, unknown> | null;
      const lines = ((r.po_cancellation_request_lines ?? []) as Record<string, unknown>[])
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
        .map((l) => {
          const pl = (l.po_line_items ?? null) as Record<string, unknown> | null;
          return {
            po_line_item_id: l.po_line_item_id as string,
            description: (pl?.description as string) ?? "",
            cancel_qty: Number(l.cancel_qty) || 0,
            open_qty: Number(l.open_qty) || 0,
            uom_code: ((pl?.uoms as Record<string, unknown> | null)?.code as string | null) ?? null,
          };
        });
      return {
        id: r.id as string,
        code: (r.code as string | null) ?? null,
        purchase_order_id: r.purchase_order_id as string,
        scope: r.scope as "whole" | "partial",
        reason: r.reason as string,
        status: r.status as PoCancelRequest["status"],
        decided_by: (r.decided_by as string | null) ?? null,
        decided_at: (r.decided_at as string | null) ?? null,
        decision_remark: (r.decision_remark as string | null) ?? null,
        created_by: (r.created_by as string | null) ?? null,
        created_at: r.created_at as string,
        po_code: (po?.code as string | null) ?? null,
        vendor_name: po ? (joined(po, "master_vendor", "name") ?? joined(po, "vendors", "name")) : null,
        lines,
      };
    }),
  );
}

// ============================================================================
// Lab
// ============================================================================
export async function listLabStandards(): Promise<LabTestStandard[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_test_standards")
    .select("*")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as LabTestStandard[]);
}
export interface LabTestWithRefs extends LabTest {
  standard_name: string | null;
}
export async function listLabTests(): Promise<LabTestWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_tests")
    .select("*, lab_test_standards(name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as LabTest),
    standard_name: joined(r, "lab_test_standards", "name"),
  })));
}
export async function getLabStandardOptions(): Promise<{ id: string; code: string | null; name: string }[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_test_standards")
    .select("id, code, name")
    .order("name");
  return (data ?? []) as { id: string; code: string | null; name: string }[];
}
