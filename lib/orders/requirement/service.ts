import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetNames, StoredRequirement } from "./sheet";

/**
 * Reading one order's Accessories Requirement.
 *
 * ## THE LATEST NON-DRAFT BOM, NOT EVERY BOM
 *
 * `amendment_no` is a per-order counter and a second document is how a Material
 * BOM is revised (0265) — nothing is carried forward and nothing is diffed. So
 * summing every amendment's requirements would add revision 1 to revision 2,
 * which is the call `bom-ceiling.ts` already makes for the purchase ceiling and
 * the same one this makes for the printed sheet. A draft is excluded because a
 * document nobody has recorded is not one to hand a supplier.
 *
 * ## IT READS `..._requirements`, NOT THE ITEM LINES
 *
 * The stored rows are what the server action wrote from the same functions the
 * operator approved on screen. Recomputing here would let the paper and the
 * purchase order disagree the moment the order moves — see `sheet.ts`.
 * `computed_at` travels with them so the sheet can say WHEN it was stored, which
 * is the honest alternative to silently reprinting a stale figure.
 */

export type RequirementSheetData = {
  bom: {
    id: string;
    code: string | null;
    amendmentNo: number | null;
    amendDate: string | null;
    /** When the stored requirement was last computed. Printed on the sheet. */
    computedAt: string | null;
    /** The production quantity the BOM planned against, as stored. */
    computedForQty: number | null;
  };
  order: {
    scNo: string | null;
    customer: string | null;
    orderNo: string | null;
    orderDate: string | null;
    deliveryDate: string | null;
    excessPct: number | null;
  };
  company: {
    name: string | null;
    address: string | null;
    gstin: string | null;
    email: string | null;
  };
  rows: StoredRequirement[];
  names: SheetNames;
};

/** What the page shows instead of a sheet. Never an empty document. */
export type SheetRefusal = { refused: string };
export const isSheetRefusal = (v: unknown): v is SheetRefusal =>
  typeof v === "object" && v !== null && typeof (v as SheetRefusal).refused === "string";

export async function getRequirementSheet(
  salesOrderId: string,
): Promise<RequirementSheetData | SheetRefusal> {
  const s = await createClient();

  const { data: bomRows, error: bomErr } = await s
    .from("material_bom_amendments")
    .select(
      "id, code, amendment_no, amend_date, is_draft, computed_at, computed_for_qty, " +
        "sales_order_id, garment_order_id, customer:customers(name)",
    )
    .eq("sales_order_id", salesOrderId)
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false })
    .limit(1);

  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY SHEET. `data ?? []` here would
  // render a document with no trims on it and no way to tell that apart from an
  // order that genuinely has none — the failure `getAmendments` records.
  if (bomErr) return { refused: `Could not read the Material BOM: ${bomErr.message}` };
  const bom = ((bomRows ?? []) as unknown as unknown[])[0] as
    | {
        id: string;
        code: string | null;
        amendment_no: number | null;
        amend_date: string | null;
        computed_at: string | null;
        computed_for_qty: number | null;
        garment_order_id: string | null;
        customer: { name: string } | null;
      }
    | undefined;

  if (!bom) {
    return {
      refused:
        "This order has no recorded Material BOM yet — raise one on Orders ▸ Material BOM before printing its requirement.",
    };
  }

  const [reqRes, orderRes, scRes, coRes] = await Promise.all([
    s
      .from("material_bom_amendment_requirements")
      .select(
        "item_id, sno, slice_label, size_id, item_color_id, no_of_items, per_pieces, " +
          "required_qty, refusal_reason, consumption_uom_id",
      )
      .eq("amendment_id", bom.id)
      .order("sno", { ascending: true }),
    bom.garment_order_id
      ? s
          .from("garment_order_amendments")
          .select("po_no, po_date, delivery_date, excess_pct")
          .eq("id", bom.garment_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    s.from("sales_orders").select("order_number").eq("id", salesOrderId).maybeSingle(),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
  ]);

  if (reqRes.error) {
    return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };
  }
  const rows = (reqRes.data ?? []) as unknown as StoredRequirement[];

  if (rows.length === 0) {
    return {
      refused:
        "This Material BOM has no stored requirement yet — open it and save, so the figures the sheet prints are the ones that were approved.",
    };
  }

  /* THE NAME LOOKUPS ARE FETCHED FOR THE IDS THAT ACTUALLY APPEAR, not as whole
     master tables. A sheet needs a dozen items, not the item master. */
  const ids = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter(Boolean))] as T[];
  const itemIds = ids(rows.map((r) => r.item_id));
  const uomIds = ids(rows.map((r) => r.consumption_uom_id));
  const sizeIds = ids(rows.map((r) => r.size_id));
  const colourIds = ids(rows.map((r) => r.item_color_id));

  const [itemRes, uomRes, sizeRes, colourRes] = await Promise.all([
    itemIds.length
      ? s.from("items").select("id, name, category:categories(name)").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    uomIds.length
      ? s.from("uoms").select("id, code, decimal_places_allowed").in("id", uomIds)
      : Promise.resolve({ data: [], error: null }),
    sizeIds.length
      ? s.from("config_lookups").select("id, name").in("id", sizeIds)
      : Promise.resolve({ data: [], error: null }),
    colourIds.length
      ? s.from("config_lookups").select("id, name").in("id", colourIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const names: SheetNames = { items: {}, uoms: {}, sizes: {}, colours: {} };
  for (const r of (itemRes.data ?? []) as unknown as {
    id: string;
    name: string;
    category: { name: string } | null;
  }[]) {
    names.items[r.id] = { name: r.name, category: r.category?.name ?? null };
  }
  for (const r of (uomRes.data ?? []) as unknown as {
    id: string;
    code: string;
    decimal_places_allowed: number | null;
  }[]) {
    names.uoms[r.id] = { code: r.code, decimals: r.decimal_places_allowed };
  }
  for (const r of (sizeRes.data ?? []) as unknown as { id: string; name: string }[]) {
    names.sizes[r.id] = r.name;
  }
  for (const r of (colourRes.data ?? []) as unknown as { id: string; name: string }[]) {
    names.colours[r.id] = r.name;
  }

  const order = orderRes.data as {
    po_no: string | null;
    po_date: string | null;
    delivery_date: string | null;
    excess_pct: number | null;
  } | null;
  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);

  return {
    bom: {
      id: bom.id,
      code: bom.code,
      amendmentNo: bom.amendment_no,
      amendDate: bom.amend_date,
      computedAt: bom.computed_at,
      computedForQty: bom.computed_for_qty,
    },
    order: {
      scNo: (scRes.data as { order_number: string | null } | null)?.order_number ?? null,
      customer: bom.customer?.name ?? null,
      orderNo: order?.po_no ?? null,
      orderDate: order?.po_date ?? null,
      deliveryDate: order?.delivery_date ?? null,
      excessPct: order?.excess_pct ?? null,
    },
    company: {
      name: str("name") ?? str("company_name"),
      address: str("address") ?? str("address_line1"),
      gstin: str("gstin"),
      email: str("email"),
    },
    rows,
    names,
  };
}
