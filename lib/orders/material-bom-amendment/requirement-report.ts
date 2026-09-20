import "server-only";
import { createClient } from "@/lib/supabase/server";
import { companyAddressOf, letterheadLogoOf } from "@/lib/orders/fabric-bom/letterhead";
import { isRefusal, requirementFor } from "@/lib/orders/material-bom/requirement";
import type { MbaRequirementReport, MbaRequirementRow } from "./requirement-report-types";

/**
 * THE MATERIAL BOM REQUIREMENT REPORT — the editor's Requirement tab, on paper
 * (client 2026-09-20: "there is no material bom report … the material bom
 * requirement tab is for can take for report").
 *
 * SAME COLUMNS, SAME ORDER AS THE TAB: Item Name, Item Color, Calculated Qty,
 * Required Qty, Uom, Purchase Uom, Stage. A reader holding the printout beside
 * the screen should be matching rows, not translating them.
 *
 * ## IT READS THE STORED ROWS, NOT THE ITEM LINES
 *
 * `material_bom_amendment_requirements` is what the save wrote from the SAME
 * functions the tab draws with, and it is what `bomCeilingForOrder` caps a
 * purchase order against. Recomputing the explosion here would let the paper and
 * the PO disagree the moment the order moves — the reason `getRequirementSheet`
 * gives for doing the same.
 *
 * ## CALCULATED QTY IS RE-DERIVED FROM THE ROW'S OWN COLUMNS
 *
 * It is not stored: `required_qty` is the figure AFTER process loss, and the tab
 * prints the one before. But a stored row carries everything `requirementFor`
 * reads — the slice quantity (`basis_qty`), the resolved ratio (`no_of_items` /
 * `per_pieces`), the wastage (`excess_pct`) — which is 0418's rule that "a
 * stored row must be re-derivable from its own columns". So this calls the same
 * function the tab and the save call, and gets the same ceilinged figure, rather
 * than dividing the loss back out of `required_qty` (which un-rounds a number
 * that was deliberately rounded — `baseRequirementFor`'s own warning).
 *
 * The save stores the slice's RESOLVED wastage since 2026-09-20; a row saved
 * before that holds the line's, which differs only where a per-attribute
 * Excess % override was typed. Re-saving the BOM brings such a row in line.
 */

type StoredRow = {
  item_line_id: string | null;
  item_id: string | null;
  sno: number;
  combo: string | null;
  basis: string | null;
  basis_qty: number | null;
  no_of_items: number | null;
  per_pieces: number | null;
  excess_pct: number | null;
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
  /** WHAT IS ACTUALLY BOUGHT, in the purchase unit — stored by the save, never
   *  re-derived here (`purchase_uom_id` alone was read until 2026-09-20, which
   *  is how the report came to print a consumption figure under a purchase
   *  unit; see the `purchaseQty` note below). */
  purchase_qty: number | null;
  purchase_uom_id: string | null;
  item_color_id: string | null;
};

type LineRow = {
  id: string;
  specification: string | null;
  size: string | null;
  purchase_stage: string | null;
  item_color_id: string | null;
};

/** What the report shows instead of a document. Never an empty table. */
type Refused = { refused: string };

/**
 * The order's CURRENT Material BOM — the latest recorded (non-draft) one.
 *
 * ## FOUND THROUGH THE GARMENT ORDER, NOT `sales_order_id`
 *
 * A Material BOM names its order by `garment_order_id`; its own
 * `sales_order_id` is NULL on every recorded BOM in the live database
 * (measured 2026-09-20: MBA-0013 … MBA-0018, all null). Looking it up by
 * `sales_order_id` alone therefore answered "no recorded Material BOM" for
 * EVERY order, which is how Order Entry ▸ Reports reached both Material BOM
 * reports and found nothing behind either. `currentFabricBom` has always gone
 * RE Number → garment order → BOM, and this now takes the same road — with the
 * direct column kept as a second door, for a BOM that does carry it.
 *
 * Every garment-order row for the RE Number is accepted, not only the newest:
 * a BOM raised against an earlier row of the same order is still that order's.
 * `amendment_no` is the per-order revision counter, so it still picks the latest.
 */
export async function currentMaterialBom(
  salesOrderId: string,
): Promise<{ id: string } | Refused> {
  const s = await createClient();
  const { data: goRows, error: goErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY REPORT.
  if (goErr) return { refused: `Could not read the order: ${goErr.message}` };
  const goIds = ((goRows ?? []) as { id: string }[]).map((g) => g.id);

  const { data, error } = await s
    .from("material_bom_amendments")
    .select("id")
    .or(
      goIds.length
        ? `sales_order_id.eq.${salesOrderId},garment_order_id.in.(${goIds.join(",")})`
        : `sales_order_id.eq.${salesOrderId}`,
    )
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { refused: `Could not read the Material BOM: ${error.message}` };
  const bom = (data ?? [])[0] as { id: string } | undefined;
  return (
    bom ?? {
      refused:
        "This order has no recorded Material BOM yet — raise one on Orders ▸ Material BOM before printing its requirement.",
    }
  );
}

export async function materialBomRequirementReport(
  bomId: string,
): Promise<MbaRequirementReport | Refused> {
  const s = await createClient();

  const { data: bomRow, error: bomErr } = await s
    .from("material_bom_amendments")
    .select(
      "id, code, amend_date, computed_at, sales_order_id, garment_order_id, customer:customers(name)",
    )
    .eq("id", bomId)
    .maybeSingle();
  if (bomErr) return { refused: `Could not read the Material BOM: ${bomErr.message}` };
  if (!bomRow) return { refused: "This Material BOM no longer exists." };
  const bom = bomRow as unknown as {
    id: string;
    code: string | null;
    amend_date: string | null;
    computed_at: string | null;
    sales_order_id: string | null;
    garment_order_id: string | null;
    customer: { name: string } | null;
  };

  const [reqRes, lineRes, orderRes, coRes] = await Promise.all([
    s
      .from("material_bom_amendment_requirements")
      .select(
        "item_line_id, item_id, sno, combo, basis, basis_qty, no_of_items, per_pieces, excess_pct, " +
          "required_qty, refusal_reason, consumption_uom_id, purchase_qty, purchase_uom_id, item_color_id",
      )
      .eq("amendment_id", bom.id)
      .order("sno", { ascending: true }),
    s
      .from("material_bom_amendment_items")
      .select("id, specification, size, purchase_stage, item_color_id")
      .eq("amendment_id", bom.id),
    bom.garment_order_id
      ? s
          .from("garment_order_amendments")
          .select("po_no, sales_order_id")
          .eq("id", bom.garment_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
  ]);
  const order = orderRes.data as { po_no: string | null; sales_order_id: string | null } | null;
  /* THE RE NUMBER COMES THROUGH THE GARMENT ORDER — the BOM's own
     `sales_order_id` is NULL on recorded BOMs (see `currentMaterialBom`), so
     reading only that printed a blank RE No on every report. */
  const soId = bom.sales_order_id ?? order?.sales_order_id ?? null;
  const scRes = soId
    ? await s.from("sales_orders").select("order_number").eq("id", soId).maybeSingle()
    : { data: null };

  if (reqRes.error) return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };
  if (lineRes.error) return { refused: `Could not read the BOM lines: ${lineRes.error.message}` };
  const stored = (reqRes.data ?? []) as unknown as StoredRow[];
  if (stored.length === 0) {
    return {
      refused:
        "This Material BOM has no stored requirement yet — open it and save, so the figures the report prints are the ones that were approved.",
    };
  }
  const lines = new Map(((lineRes.data ?? []) as LineRow[]).map((l) => [l.id, l]));

  /* THE NAME LOOKUPS FOR THE IDS THAT ACTUALLY APPEAR — a report needs a dozen
     items, not the item master. */
  const ids = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const itemIds = ids(stored.map((r) => r.item_id));
  const uomIds = ids(stored.flatMap((r) => [r.consumption_uom_id, r.purchase_uom_id]));
  const colourIds = ids([
    ...stored.map((r) => r.item_color_id),
    ...[...lines.values()].map((l) => l.item_color_id),
  ]);
  const [itemRes, uomRes, colourRes] = await Promise.all([
    itemIds.length
      ? s.from("items").select("id, name").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    uomIds.length
      ? s.from("uoms").select("id, code, decimal_places_allowed").in("id", uomIds)
      : Promise.resolve({ data: [], error: null }),
    colourIds.length
      ? s.from("config_lookups").select("id, name").in("id", colourIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const itemName = new Map(((itemRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const uoms = new Map(
    ((uomRes.data ?? []) as { id: string; code: string; decimal_places_allowed: number | null }[]).map(
      (r) => [r.id, { code: r.code, decimals: r.decimal_places_allowed }],
    ),
  );
  const colourName = new Map(((colourRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  const rows: MbaRequirementRow[] = stored.map((r, i) => {
    const line = r.item_line_id ? lines.get(r.item_line_id) : undefined;
    const uom = r.consumption_uom_id ? uoms.get(r.consumption_uom_id) : undefined;
    /* THE TAB'S "Item Name" — the material, its specification and its size,
       slash-joined (`itemDisplayName`, client 2026-08-29). */
    const material = [r.item_id ? (itemName.get(r.item_id) ?? "(unknown item)") : "", line?.specification, line?.size]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(" / ");
    /* THE TAB'S "Item Color" (`colourOf`): the trim colour, else — on a
       colour-wise line — the colourway the slice is for. The ROW's stored
       colour first, since the save resolved the slice's own tick into it. */
    const colourId = r.item_color_id ?? line?.item_color_id ?? null;
    const colour =
      (colourId ? colourName.get(colourId) : undefined) ??
      (r.basis === "colour" ? (r.combo ?? "—") : "—");
    /* A REFUSED ROW HAS NO CALCULATED FIGURE EITHER — the chain refuses as a
       whole, and a number beside a sentence would read as half an answer. */
    const calc =
      r.required_qty == null
        ? null
        : requirementFor(
            {
              no_of_items: r.no_of_items,
              per_pieces: r.per_pieces,
              excess_pct: r.excess_pct ?? 0,
              decimals: uom?.decimals ?? null,
            },
            { key: String(i), label: "", qty: Number(r.basis_qty ?? 0), style_ref_no: null, combo: r.combo, size_id: null },
          );
    /* PURCHASE UOM ONLY WHERE A PACK CONVERTS — the tab prints "—" on a line
       bought in the unit it is consumed in, and so does this. */
    const converts = !!r.purchase_uom_id && r.purchase_uom_id !== r.consumption_uom_id;
    const purchaseUom = converts ? (uoms.get(r.purchase_uom_id as string)?.code ?? "—") : "—";
    /**
     * AND THE FIGURE THAT UNIT MEASURES (client 2026-09-20: "the UOM for
     * Buttons should be shown as Gross").
     *
     * The report used to print the purchase UNIT and never the purchase
     * QUANTITY, so a button line read "5,225 · NOS · GROSS" — the 5,225 is
     * pieces, the GROSS beside it is what the line is bought in, and the two
     * sitting in one row read as one number in the wrong unit. 36.28 GROSS is
     * what is ordered, and the save has stored it all along (`purchase_qty`,
     * `toPurchaseQty` on the tab): the column was simply never printed.
     *
     * READ, NOT RE-DERIVED — the file header's rule. Dividing 5,225 by the pack
     * here would round a second time and could disagree with the tab.
     */
    const purchaseUomDecimals = converts ? (uoms.get(r.purchase_uom_id as string)?.decimals ?? null) : null;
    return {
      key: `${r.sno}`,
      material: material || "(unknown item)",
      colour,
      calculated: calc == null || isRefusal(calc) ? null : calc,
      required: r.required_qty,
      refusal: r.required_qty == null ? (r.refusal_reason ?? "—") : null,
      uom: uom?.code ?? "—",
      decimals: uom?.decimals ?? null,
      purchaseQty: converts ? r.purchase_qty : null,
      purchaseUom,
      purchaseDecimals: purchaseUomDecimals,
      stage: (line?.purchase_stage ?? "").trim() || "—",
    };
  });

  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);

  return {
    header: {
      bomCode: bom.code,
      bomDate: bom.amend_date,
      computedAt: bom.computed_at,
      scNo: (scRes.data as { order_number: string | null } | null)?.order_number ?? null,
      customer: bom.customer?.name ?? null,
      orderNo: order?.po_no ?? null,
      company: {
        name: str("name") ?? str("company_name"),
        address: companyAddressOf(co),
        gstin: str("gstin"),
        logo: letterheadLogoOf(co),
      },
    },
    rows,
  };
}
