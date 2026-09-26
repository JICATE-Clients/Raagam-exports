import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EntryFacts, FabricSheetNames, StoredFabricRequirement, StoredYarn } from "./sheet";
/* THE RULE 2 ROLL WEIGHTS (0564) come from the report that already computes
   them — see `FabricRequirementSheetData.cloth`. One demand, one walk of one
   route, two documents. */
import { yarnFabricRequirementReport, isReportRefusal } from "@/lib/orders/fabric-bom/reports";
import type { ClothPurchaseLine } from "@/lib/orders/fabric-bom/reports";
import { companyAddressOf } from "@/lib/orders/fabric-bom/letterhead";

/**
 * Reading one order's Fabric Requirement.
 *
 * ## IT KEYS ON THE SALES ORDER AND RESOLVES THE REST
 *
 * The URL is `/orders/<sales order id>/fabric-requirement`, the same shape as
 * `/gos` and `/requirement` beside it, because the floor asks for "the fabric
 * sheet for HO/RE/26-27/0009" — a RE Number, never a BOM id.
 *
 * That costs one hop the accessories sheet does not pay. `material_bom_amendments`
 * carries `sales_order_id` directly; `order_fabric_boms` carries only
 * `garment_order_id`, so this resolves the garment order first. Keeping the URL
 * shape and paying the hop is the right way round: a URL that named the BOM
 * would be one nobody on the floor can construct, and the id changes every time
 * the order is amended.
 *
 * ## THE LATEST NON-DRAFT BOM, NOT EVERY BOM
 *
 * A second document is how a BOM is revised — nothing is carried forward and
 * nothing is diffed — so summing every one would add revision 1 to revision 2.
 * Same call the accessories sheet makes. A draft is excluded because a document
 * nobody has recorded is not one to hand a knitter.
 *
 * ORDERED BY `bom_date` THEN `created_at`, and both are needed. `order_fabric_boms`
 * has no `amendment_no` counter of its own — the column the accessories side
 * sorts on — so the date is the revision order, and `created_at` breaks the tie
 * when two revisions were recorded on one day. Sorting on `created_at` alone
 * would let a back-dated correction entered this afternoon outrank the revision
 * it was correcting.
 *
 * ## IT READS `..._requirements`, NOT THE ENTRIES
 *
 * The stored rows are what the server action wrote from the same functions the
 * operator approved on screen. Recomputing here would let the paper and the
 * purchase order disagree the moment the order moves — see `sheet.ts`.
 * `computed_at` travels with them so the sheet can say WHEN it was stored, which
 * is the honest alternative to silently reprinting a stale figure.
 */

export type FabricRequirementSheetData = {
  bom: {
    id: string;
    code: string | null;
    bomDate: string | null;
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
  };
  rows: StoredFabricRequirement[];
  yarns: StoredYarn[];
  /**
   * THE RULE 2 DEMAND (0564) — greige or dyed ROLLS to buy, for the fabrics
   * this order does not knit. `doc/order/fabriprocess.md` §2: "On the
   * Material Requirement Sheet, the demand shifts directly to Greige Fabric
   * Roll Weight (in Kg) rather than raw grey yarn."
   *
   * ## IT IS BORROWED, NOT COMPUTED HERE, AND THAT IS THE WHOLE DESIGN
   *
   * These lines come from `yarnFabricRequirementReport` — the Yarn & Fabric
   * Requirement Report's own `clothPurchase` section, grossed by the same
   * single walk of the same route it prints its stage ledger from. Deriving
   * them again here would be two implementations of one demand, and the two
   * would part company the first time a rounding or a suppression changed on
   * one side; this file's own header forbids exactly that for the requirement
   * and the reasoning does not stop at the requirement.
   *
   * IT IS LIVE-COMPUTED RATHER THAN STORED, which is a real departure from
   * "IT NEVER RECOMPUTES" above and is stated rather than hidden: nothing
   * persists a ladder today (see `comboUpliftBreakdown`'s header), so there
   * is no stored roll weight to read. The report has printed its stage ledger
   * on the same footing since it was built. Persisting it — a small additive
   * child written by `writeYarns` at save time — is the real next step and is
   * what would let this array be read instead of derived.
   *
   * EMPTY on an all-Rule-1 document, which is every BOM before 2026-09-16.
   */
  cloth: ClothPurchaseLine[];
  /** Summed across `cloth`, or null where the lines disagree on a unit — the
   *  report's own "one unit or nothing" rule, carried rather than restated. */
  clothTotal: { qty: number; uomCode: string | null } | null;
  names: FabricSheetNames;
};

/** What the page shows instead of a sheet. Never an empty document. */
export type FabricSheetRefusal = { refused: string };
export const isFabricSheetRefusal = (v: unknown): v is FabricSheetRefusal =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as FabricSheetRefusal).refused === "string";

type CurrentGarmentOrder = {
  id: string;
  po_no: string | null;
  po_date: string | null;
  delivery_date: string | null;
  excess_pct: number | null;
  customer: { name: string } | null;
};

type CurrentFabricBom = {
  id: string;
  code: string | null;
  bom_date: string | null;
  computed_at: string | null;
  computed_for_qty: number | null;
};

/**
 * THE ORDER'S CURRENT FABRIC BOM — the latest garment order on the RE Number,
 * then its latest NON-DRAFT Fabric BOM (see "THE LATEST NON-DRAFT BOM" above).
 *
 * Exported so every per-order Fabric BOM report resolves "current" by this ONE
 * rule — the Fabric Requirement sheet here, and the Entry Register / Yarn &
 * Fabric / Printing reports at `/orders/<id>/reports/<key>`. Two copies of the
 * query would be two answers to "which BOM is this order's", and the day they
 * disagree the order's reports print different revisions side by side.
 */
export async function currentFabricBom(
  salesOrderId: string,
): Promise<{ go: CurrentGarmentOrder; bom: CurrentFabricBom } | FabricSheetRefusal> {
  const s = await createClient();

  const { data: goRows, error: goErr } = await s
    .from("garment_order_amendments")
    .select("id, po_no, po_date, delivery_date, excess_pct, customer:customers(name)")
    .eq("sales_order_id", salesOrderId)
    .order("created_at", { ascending: false })
    .limit(1);

  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY SHEET. `data ?? []` here would
  // render a document with no cloth on it and no way to tell that apart from an
  // order that genuinely needs none — the failure `getAmendments` records.
  if (goErr) return { refused: `Could not read the order: ${goErr.message}` };
  const go = ((goRows ?? []) as unknown as unknown[])[0] as CurrentGarmentOrder | undefined;

  if (!go) return { refused: "This RE Number has no garment order behind it." };

  const { data: bomRows, error: bomErr } = await s
    .from("order_fabric_boms")
    .select("id, code, bom_date, computed_at, computed_for_qty")
    .eq("garment_order_id", go.id)
    .eq("is_draft", false)
    .order("bom_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (bomErr) return { refused: `Could not read the Fabric BOM: ${bomErr.message}` };
  const bom = ((bomRows ?? []) as unknown as unknown[])[0] as CurrentFabricBom | undefined;

  if (!bom) {
    return {
      refused:
        "This order has no recorded Fabric BOM yet — raise one on Orders ▸ Fabric BOM before printing its requirement.",
    };
  }

  return { go, bom };
}

export async function getFabricRequirementSheet(
  salesOrderId: string,
): Promise<FabricRequirementSheetData | FabricSheetRefusal> {
  const current = await currentFabricBom(salesOrderId);
  if (isFabricSheetRefusal(current)) return current;
  const { go, bom } = current;
  const s = await createClient();

  const [reqRes, yarnRes, entryRes, scRes, coRes] = await Promise.all([
    s
      .from("order_fabric_bom_requirements")
      .select(
        "entry_id, item_id, sno, basis, style_ref_no, combo, size_id, slice_label, " +
          "basis_qty, consumption, wastage_pct, required_qty, refusal_reason, consumption_uom_id",
      )
      .eq("bom_id", bom.id)
      .order("sno", { ascending: true }),
    /* THE YARN PURCHASE (0493). Fetched with the requirement rather than after
       it, because the page renders both or neither and a second round trip would
       buy nothing — the two are independent selects on one bom id. */
    s
      .from("order_fabric_bom_yarns")
      .select("item_id, sno, purchase_qty, uom_id, refusal_reason")
      .eq("bom_id", bom.id)
      .order("sno", { ascending: true }),
    /* THE ENTRIES, for the structure / components / style each requirement row
       was planned under. The requirement carries `entry_id` and nothing else
       about its parent (0494), so without this the document could print a
       quantity with no way to say which panel of which style it is for — and two
       entries of one fabric would read as duplicates of each other. */
    s
      .from("order_fabric_bom_manual_entries")
      .select(
        "id, sno, style_ref_no, width_form, structure:categories(name), " +
          "components:order_fabric_bom_manual_components(component:components(short_name))",
      )
      .eq("bom_id", bom.id),
    s.from("sales_orders").select("order_number").eq("id", salesOrderId).maybeSingle(),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
  ]);

  if (reqRes.error) {
    return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };
  }
  if (yarnRes.error) {
    return { refused: `Could not read the yarn purchase rows: ${yarnRes.error.message}` };
  }
  if (entryRes.error) {
    return { refused: `Could not read the BOM's entries: ${entryRes.error.message}` };
  }

  const rows = (reqRes.data ?? []) as unknown as StoredFabricRequirement[];
  const yarns = (yarnRes.data ?? []) as unknown as StoredYarn[];

  if (rows.length === 0) {
    return {
      refused:
        "This Fabric BOM has no stored requirement yet — open it and save, so the figures the sheet prints are the ones that were approved.",
    };
  }

  /* THE NAME LOOKUPS ARE FETCHED FOR THE IDS THAT ACTUALLY APPEAR, not as whole
     master tables. A sheet needs a handful of fabrics, not the item master.
     THE YARNS' IDS ARE IN THE SAME QUERY — they resolve against `items` too, and
     a second `.in()` over the same table would be one round trip to answer half
     a question. */
  const ids = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter(Boolean))] as T[];
  const itemIds = ids([...rows.map((r) => r.item_id), ...yarns.map((y) => y.item_id)]);
  const uomIds = ids([...rows.map((r) => r.consumption_uom_id), ...yarns.map((y) => y.uom_id)]);

  const [itemRes, uomRes] = await Promise.all([
    itemIds.length
      ? s.from("items").select("id, name, category:categories(name)").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    uomIds.length
      ? s.from("uoms").select("id, code, decimal_places_allowed").in("id", uomIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const names: FabricSheetNames = { items: {}, uoms: {}, entries: {} };
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
  for (const e of (entryRes.data ?? []) as unknown as {
    id: string;
    sno: number;
    style_ref_no: string | null;
    width_form: string | null;
    structure: { name: string } | null;
    components: { component: { short_name: string } | null }[] | null;
  }[]) {
    const facts: EntryFacts = {
      sno: e.sno,
      styleRefNo: e.style_ref_no,
      structure: e.structure?.name ?? null,
      /* SORTED BY NAME, because PostgREST makes no ordering promise on an embed
         and the component set is printed as one string. Unsorted, the same entry
         could read `NECK · BODY` on one print and `BODY · NECK` on the next, and
         two prints of one document that differ are two documents. */
      components: (e.components ?? [])
        .map((c) => c.component?.short_name ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      widthForm: e.width_form,
    };
    names.entries[e.id] = facts;
  }

  /* THE ROLL WEIGHTS (0564), borrowed from the Yarn & Fabric Requirement
     Report. ITS REFUSAL IS NOT THIS DOCUMENT'S REFUSAL: that report declines
     a BOM with no stored yarn and nothing purchased, which is a perfectly
     printable Fabric Requirement Sheet — the requirement rows this page is
     actually about are already in hand. So a refusal degrades this section to
     empty rather than taking the page with it, and an all-Rule-1 document
     (every BOM before today) reaches that branch on purpose. */
  const clothReport = await yarnFabricRequirementReport(bom.id, { allocation: false });
  const cloth = isReportRefusal(clothReport) ? [] : clothReport.clothPurchase;
  const clothTotal = isReportRefusal(clothReport) ? null : clothReport.clothPurchaseTotal;

  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);

  return {
    bom: {
      id: bom.id,
      code: bom.code,
      bomDate: bom.bom_date,
      computedAt: bom.computed_at,
      computedForQty: bom.computed_for_qty,
    },
    order: {
      scNo: (scRes.data as { order_number: string | null } | null)?.order_number ?? null,
      customer: go.customer?.name ?? null,
      orderNo: go.po_no,
      orderDate: go.po_date,
      deliveryDate: go.delivery_date,
      excessPct: go.excess_pct,
    },
    /* THE SAME TWO-NAME FALLBACK THE ACCESSORIES SHEET USES, and copied
       deliberately rather than tidied: `company_profile` has carried both
       spellings since the masters rebuild, and a letterhead that resolves on one
       document and prints blank on the other is the drift this pair exists to
       avoid. */
    company: {
      name: str("name") ?? str("company_name"),
      /* Built from street1..3 / city / state / pin — the columns the Company
         Profile actually saves (2026-09-19; `address` never existed). */
      address: companyAddressOf(co),
      gstin: str("gstin"),
    },
    rows,
    yarns,
    cloth,
    clothTotal,
    names,
  };
}
