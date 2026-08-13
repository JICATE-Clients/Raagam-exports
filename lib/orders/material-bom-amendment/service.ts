import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listVendorNominations, listVendorsForPicker } from "@/lib/masters/vendor-service";
import type { VendorNomination } from "@/lib/masters/vendor-nominations";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { MaterialBomAmendment, BomCopySource } from "./types";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import type { RejectionTier } from "@/lib/masters/rejection-rule";
import {
  basisFingerprint,
  totalProductionOf,
  isRefusal,
  type OrderProductionInput,
} from "@/lib/orders/material-bom/requirement";
import { bomStatusOf, BOM_STATUS_RANK, type BomStatus } from "./status";

// ---------------------------------------------------------------------------
// The order, and what the requirement needs from it
// ---------------------------------------------------------------------------

/**
 * The garment order's own tabs, as PostgREST returns them.
 *
 * ONE UNRESOLVABLE RELATIONSHIP FAILS THE WHOLE QUERY, not just its branch —
 * the standing warning on `lib/orders/amendments/service.ts`'s much larger
 * select. So this asks for the four children the requirement actually needs and
 * nothing else: the more names in the string, the more ways an unrelated schema
 * change blanks this screen.
 */
const ORDER_SELECT =
  "id, code, po_no, amend_date, delivery_date, excess_pct, rejection_rule_id, " +
  "customer:customers(id,code,name), " +
  "sales_order:sales_orders(id,order_number), " +
  "styles:garment_order_amendment_styles(style_ref_no), " +
  "approval_qtys:garment_order_amendment_approval_qtys(style_ref_no,combo,qty,approval_qty), " +
  "combos:garment_order_amendment_combos(style_ref_no,combo), " +
  "quantities:garment_order_amendment_quantities(style_ref_no, " +
  "assort_lines:garment_order_amendment_assort_lines(combo,no_of_cartons, " +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty)))";

type OrderRow = {
  id: string;
  code: string | null;
  po_no: string | null;
  amend_date: string;
  delivery_date: string | null;
  excess_pct: number | null;
  rejection_rule_id: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  sales_order: { id: string; order_number: string | null } | null;
  styles: { style_ref_no: string | null }[] | null;
  approval_qtys:
    | { style_ref_no: string | null; combo: string | null; qty: number; approval_qty: number }[]
    | null;
  combos: { style_ref_no: string | null; combo: string | null }[] | null;
  quantities:
    | {
        style_ref_no: string | null;
        assort_lines:
          | {
              combo: string | null;
              no_of_cartons: number | null;
              sizes: { size_id: string | null; qty: number | null }[] | null;
            }[]
          | null;
      }[]
    | null;
};

/**
 * The order shaped for `lib/orders/material-bom/requirement.ts`.
 *
 * The assort tree is flattened to (style, combo, size, pieces) with
 * `no_of_cartons x that size's per-carton qty` — the SAME multiplication
 * `pricingWeights` does in `amendment-screen.tsx` for Average Rate. Two callers
 * reading one tree two ways is how two screens start disagreeing about an
 * order's size curve, so the expression is copied deliberately and named here.
 *
 * `sizeName` is supplied by the caller that has the lookups; without it a slice
 * is labelled with its uuid, which is legible to nobody.
 */
export function orderProductionInput(
  row: OrderRow,
  tiersById: Map<string, RejectionTier[]>,
  sizeName?: (id: string) => string,
): OrderProductionInput {
  const assortSizes = (row.quantities ?? []).flatMap((q) =>
    (q.assort_lines ?? []).flatMap((l) =>
      (l.sizes ?? []).map((z) => ({
        style_ref_no: q.style_ref_no,
        combo: l.combo,
        size_id: z.size_id,
        qty: (Number(l.no_of_cartons) || 0) * (Number(z.qty) || 0),
      })),
    ),
  );

  return {
    excessPct: Number(row.excess_pct) || 0,
    // A rule NAMED is what makes a tier gap a refusal rather than a zero buffer
    // (see `productionTarget`). Read off the order, never inferred from whether
    // tiers happened to resolve.
    rejectionRuleChosen: !!row.rejection_rule_id,
    tiers: row.rejection_rule_id ? (tiersById.get(row.rejection_rule_id) ?? null) : null,
    approvals: (row.approval_qtys ?? []).map((a) => ({
      style_ref_no: a.style_ref_no,
      combo: a.combo,
      qty: Number(a.qty) || 0,
      approval_qty: Number(a.approval_qty) || 0,
    })),
    combos: (row.combos ?? []).map((c) => ({
      style_ref_no: c.style_ref_no,
      combo: c.combo,
    })),
    assortSizes,
    sizeName,
  };
}

/**
 * Every rejection rule's tiers, keyed by id.
 *
 * `blocked` rows are SELECTED, not filtered: a rule switched off after an order
 * named it must still resolve, or that order's Projection — and so its whole
 * material plan — would silently change. Same call `getRejectionRuleRows` makes
 * in the amendment service.
 */
async function rejectionTiersById(): Promise<Map<string, RejectionTier[]>> {
  const s = await createClient();
  const { data } = await s
    .from("garment_rejection_rules")
    .select(
      "id, lines:garment_rejection_rule_lines(from_value,to_value,rejection_allowance,allowance_type)",
    );
  const out = new Map<string, RejectionTier[]>();
  for (const r of (data ?? []) as unknown as { id: string; lines: RejectionTier[] | null }[]) {
    out.set(r.id, r.lines ?? []);
  }
  return out;
}

async function sizeNameFn(): Promise<(id: string) => string> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, name")
    .eq("kind", "size");
  const byId = new Map((data ?? []).map((r) => [r.id as string, r.name as string]));
  return (id: string) => byId.get(id) ?? id;
}

// ---------------------------------------------------------------------------
// The dashboard: one row per ORDER, not one per BOM
// ---------------------------------------------------------------------------

/**
 * The merchandiser's work queue.
 *
 * IT LISTS ORDERS, NOT DOCUMENTS, and that is the whole change. Listing BOM
 * documents makes an order with no BOM invisible — precisely the order that
 * needs one — so "Pending" could never be shown for the case it exists to
 * describe.
 */
export type BomTaskRow = {
  /** The garment order id — the row's identity. */
  id: string;
  sc_no: string | null;
  order_code: string | null;
  po_no: string | null;
  customer_name: string | null;
  amend_date: string;
  delivery_date: string | null;
  style_count: number;
  /** Total production the order currently implies. Null when unanswerable. */
  production_qty: number | null;
  /** Why it is unanswerable, when it is — printed rather than left as a dash. */
  production_refusal: string | null;
  status: BomStatus;
  /** The BOM to open, or null to start one. */
  bom_id: string | null;
  bom_code: string | null;
  bom_line_count: number;
  created_at: string;
  created_by: string | null;
};

export async function listMaterialBomTasks(): Promise<BomTaskRow[]> {
  const s = await createClient();

  const [tiers, ordersRes, bomsRes] = await Promise.all([
    rejectionTiersById(),
    s
      .from("garment_order_amendments")
      .select(ORDER_SELECT)
      .order("created_at", { ascending: false }),
    s
      .from("material_bom_amendments")
      .select(
        "id, code, garment_order_id, amendment_no, is_draft, computed_basis_hash, " +
          "computed_for_qty, created_at, created_by, " +
          "items:material_bom_amendment_items(id)",
      )
      .order("amendment_no", { ascending: false }),
  ]);

  const orders = (ordersRes.data ?? []) as unknown as (OrderRow & {
    created_at: string;
    created_by: string | null;
  })[];

  type BomLite = {
    id: string;
    code: string | null;
    garment_order_id: string | null;
    amendment_no: number;
    is_draft: boolean;
    computed_basis_hash: string | null;
    computed_for_qty: number | null;
    created_at: string;
    created_by: string | null;
    items: { id: string }[] | null;
  };

  // The LATEST amendment per order. The select is already ordered by
  // amendment_no descending, so the first one seen wins — a later revision is
  // what the queue should be reporting on.
  const latest = new Map<string, BomLite>();
  for (const b of (bomsRes.data ?? []) as unknown as BomLite[]) {
    if (!b.garment_order_id) continue;
    if (!latest.has(b.garment_order_id)) latest.set(b.garment_order_id, b);
  }

  const rows: BomTaskRow[] = orders.map((o) => {
    const input = orderProductionInput(o, tiers);
    const total = totalProductionOf(input);
    const bom = latest.get(o.id) ?? null;
    const lineCount = bom?.items?.length ?? 0;

    const now = {
      // A refused total means the order cannot be fingerprinted into anything
      // comparable, so freshness is `unresolved` rather than a guess.
      hash: isRefusal(total) ? null : basisFingerprint(input),
      qty: isRefusal(total) ? null : total,
    };

    return {
      id: o.id,
      sc_no: o.sales_order?.order_number ?? null,
      order_code: o.code,
      po_no: o.po_no,
      customer_name: o.customer?.name ?? null,
      amend_date: o.amend_date,
      delivery_date: o.delivery_date,
      style_count: (o.styles ?? []).length,
      production_qty: now.qty,
      production_refusal: isRefusal(total) ? total.refused : null,
      status: bomStatusOf(
        bom
          ? {
              is_draft: bom.is_draft,
              lineCount,
              computed_basis_hash: bom.computed_basis_hash,
              computed_for_qty: bom.computed_for_qty,
            }
          : null,
        now,
      ),
      bom_id: bom?.id ?? null,
      bom_code: bom?.code ?? null,
      bom_line_count: lineCount,
      // The ORDER's provenance, not the BOM's: the row is an order, and an order
      // with no BOM still has a creator worth showing.
      created_at: o.created_at,
      created_by: o.created_by,
    };
  });

  // Work first: Recalculate, Pending, Draft, Unresolved, then Updated.
  rows.sort(
    (a, b) =>
      BOM_STATUS_RANK[a.status] - BOM_STATUS_RANK[b.status] ||
      (a.delivery_date ?? "9999").localeCompare(b.delivery_date ?? "9999"),
  );

  return withCreators(rows);
}

/**
 * The BOM status for every garment order, for the ORDER list's column.
 *
 * A SEPARATE call, deliberately not a new embed on `getAmendments()`: that
 * select already names 14 relationships and one unresolvable name fails the
 * whole query, so growing it puts the entire Garment Order screen at risk to add
 * a column. It also reads only `computed_basis_hash`, so no child rows are
 * fetched to answer it.
 */
export async function listMaterialBomStatus(): Promise<
  Record<string, { status: BomStatus; qty: number | null }>
> {
  const tasks = await listMaterialBomTasks();
  const out: Record<string, { status: BomStatus; qty: number | null }> = {};
  for (const t of tasks) out[t.id] = { status: t.status, qty: t.production_qty };
  return out;
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

/** All BOM documents with their order, customer and child grids. */
export async function listMaterialBomAmendments(): Promise<MaterialBomAmendment[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_bom_amendments")
    .select(
      "*, garment_order:garment_order_amendments(id, code, po_no, amend_date, delivery_date, " +
        "excess_pct, rejection_rule_id, customer:customers(id,code,name), " +
        "sales_order:sales_orders(id,order_number)), " +
        "customer:customers(id,code,name), " +
        "items:material_bom_amendment_items(*), " +
        "processes:material_bom_amendment_processes(*), " +
        "requirements:material_bom_amendment_requirements(*)",
    )
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as MaterialBomAmendment[]).map((r) => ({
      ...r,
      items: [...(r.items ?? [])].sort((a, b) => a.sno - b.sno),
      processes: [...(r.processes ?? [])].sort((a, b) => a.sno - b.sno),
      requirements: [...(r.requirements ?? [])].sort((a, b) => a.sno - b.sno),
    })),
  );
}

/**
 * One order's production input, for the editor.
 *
 * Fetched when an order is PICKED rather than shipped with the form data for
 * every order: the requirement recalculates as the operator types, but only the
 * line changes — the order's approval quantities do not — so this is one round
 * trip per order, not per keystroke.
 */
export async function getOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionInput | null> {
  const s = await createClient();
  const [tiers, sizeName, res] = await Promise.all([
    rejectionTiersById(),
    sizeNameFn(),
    s.from("garment_order_amendments").select(ORDER_SELECT).eq("id", garmentOrderId).maybeSingle(),
  ]);
  if (!res.data) return null;
  return orderProductionInput(res.data as unknown as OrderRow, tiers, sizeName);
}

/**
 * Orders whose BOM is worth copying from.
 *
 * RECORDED ONLY, and only with lines. A draft is someone's half-finished
 * thinking, and copying it spreads the half-finished state to a second order
 * where it is even harder to notice.
 */
export async function listBomCopySources(): Promise<BomCopySource[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_bom_amendments")
    .select(
      "id, code, amend_date, customer_id, " +
        "garment_order:garment_order_amendments(customer:customers(id,name), sales_order:sales_orders(order_number)), " +
        "items:material_bom_amendment_items(id)",
    )
    .eq("is_draft", false)
    .order("amend_date", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    amend_date: string;
    customer_id: string | null;
    garment_order: {
      customer: { id: string; name: string } | null;
      sales_order: { order_number: string | null } | null;
    } | null;
    items: { id: string }[] | null;
  }[])
    .filter((r) => (r.items ?? []).length > 0)
    .map((r) => ({
      bom_id: r.id,
      code: r.code,
      sc_no: r.garment_order?.sales_order?.order_number ?? null,
      customer_name: r.garment_order?.customer?.name ?? null,
      customer_id: r.garment_order?.customer?.id ?? r.customer_id ?? null,
      amend_date: r.amend_date,
      line_count: (r.items ?? []).length,
    }));
}

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

/** Shaped for `RecordPicker` — `inactive` included so a retired material, UOM or
 *  vendor stops being offered while the BOM lines that already name it still
 *  read (AGENTS.md, "Disabled rows"). */
export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };

/** A material's pack size, e.g. "1 Cone = 2,500 MTR" (0348). Fetched flat for
 *  every material and filtered client-side by item_id, so changing the item on a
 *  BOM line re-populates the pack picker without a round trip. */
export type MbaConversionRow = {
  id: string;
  item_id: string;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

async function getConversionRows(): Promise<MbaConversionRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_uom_conversions")
    .select("id, item_id, alt_qty, alt_uom_id, base_qty, base_uom_id")
    .order("sno");
  return (data ?? []) as MbaConversionRow[];
}

async function pickerRows(table: string): Promise<PickerRow[]> {
  const s = await createClient();
  // `items` spells the flag `is_active`; normalized here so the shape handed to
  // the screen is the same one every other option list uses.
  const { data } = await s.from(table).select("id, code, name, is_active").order("name");
  return ((data ?? []) as (Omit<PickerRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    inactive: isInactive(r),
  }));
}

/**
 * Processes that can be run on a trim or accessory.
 *
 * Narrowed on `for_trims`, because the Process grid here sends BUTTONS out for
 * dyeing, not garments out for washing. `inactive` is read rather than filtered
 * in SQL, so a process a saved row already names still resolves — the second
 * half of AGENTS.md's "Disabled rows" rule, which a SQL filter satisfies only
 * for new documents.
 */
async function getProcessRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, inactive, for_trims")
    .eq("for_trims", true)
    .order("name");
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null }[]).map((r) => ({
    id: r.id,
    code: null,
    name: r.name,
    inactive: isInactive(r),
  }));
}

/**
 * UOM plus its decimal precision, needed to render a purchase quantity.
 *
 * NB `decimal_places_allowed` (0309, defaults 2), NOT `decimal_places` (0224,
 * defaults 0 and is 0 for every row in the live DB). The client chose exact
 * decimals over rounding up to whole packs — 16.67 Gross, not 17 — and
 * `decimal_places` would silently reinstate the round-up on every unit.
 * `uomPrecision` in lib/uom/convert.ts clamps it either way, but selecting the
 * wrong column here is still the bug that clamp exists to survive.
 */
export type UomRow = PickerRow & { decimal_places_allowed: number | null };

async function getUomRows(): Promise<UomRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name, decimal_places_allowed, is_active")
    .order("name");
  return ((data ?? []) as (Omit<UomRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    ...r,
    inactive: isInactive(r),
  }));
}

export type { VendorNomination } from "@/lib/masters/vendor-nominations";

/**
 * The Vendor MASTER (`master_vendors`), NOT the purchase-side `public.vendors`.
 *
 * Both halves of this field had to move together: `customer_nominated_vendors`
 * points at `master_vendors` (0376), so narrowing this picker to a customer's
 * nominations means it now offers `master_vendors.id` — and 0377 repointed
 * `material_bom_amendment_items.vendor_id` to match. Reading `vendors` here
 * would offer ids the FK rejects on every save. 0418 pointed the Processes
 * grid's new `vendor_id` at the same master for the same reason.
 */
async function getVendorRows(): Promise<PickerRow[]> {
  return listVendorsForPicker();
}

/** A garment order, for the editor's SC No picker. */
export type BomOrderOption = {
  id: string;
  code: string | null;
  sc_no: string | null;
  po_no: string | null;
  customer_id: string | null;
  customer_name: string | null;
  amend_date: string;
  delivery_date: string | null;
  /** The style refs this order carries, for the line-level Style picker. */
  styles: string[];
};

async function getOrderOptions(): Promise<BomOrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_order_amendments")
    .select(
      "id, code, po_no, amend_date, delivery_date, " +
        "customer:customers(id,name), sales_order:sales_orders(order_number), " +
        "styles:garment_order_amendment_styles(style_ref_no)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    po_no: string | null;
    amend_date: string;
    delivery_date: string | null;
    customer: { id: string; name: string } | null;
    sales_order: { order_number: string | null } | null;
    styles: { style_ref_no: string | null }[] | null;
  }[]).map((o) => ({
    id: o.id,
    code: o.code,
    sc_no: o.sales_order?.order_number ?? null,
    po_no: o.po_no,
    customer_id: o.customer?.id ?? null,
    customer_name: o.customer?.name ?? null,
    amend_date: o.amend_date,
    delivery_date: o.delivery_date,
    styles: (o.styles ?? []).map((x) => x.style_ref_no ?? "").filter(Boolean),
  }));
}

export type MbaFormData = {
  orders: BomOrderOption[];
  customers: Customer[];
  items: PickerRow[];
  vendors: PickerRow[];
  /** Every customer's nominated / recommended vendors — see `VendorNomination`. */
  nominations: VendorNomination[];
  processes: PickerRow[];
  uoms: UomRow[];
  conversions: MbaConversionRow[];
  lookups: ConfigLookup[];
};

/** Every picker option list the editor needs, fetched in parallel. */
export async function getMbaFormData(): Promise<MbaFormData> {
  const [orders, customers, items, vendors, nominations, processes, uoms, conversions, lookups] =
    await Promise.all([
      getOrderOptions(),
      listCustomers(),
      pickerRows("items"),
      getVendorRows(),
      listVendorNominations(),
      getProcessRows(),
      getUomRows(),
      getConversionRows(),
      listConfigLookups(),
    ]);
  return {
    orders,
    customers,
    items,
    vendors,
    nominations,
    processes,
    uoms,
    conversions,
    lookups,
  };
}
