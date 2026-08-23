import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildGosSheet, type GosSource } from "./sheet";
import type { GosSheet, Refusal } from "./types";

/**
 * LOADING A GARMENT ORDER SHEET.
 *
 * Ids in, names out — the builder in `./sheet.ts` never sees a uuid it would
 * have to resolve, because the sheet crosses a server/client boundary and a
 * resolver function cannot cross it (`OrderProductionInput.sizeNames` records
 * the same constraint).
 *
 * ## THE SHEET IS KEYED ON THE ORDER, NOT ON THE AMENDMENT
 *
 * The floor asks for "the sheet for U2/RE//2627/2035", never for GOA-0011. So
 * this takes a `sales_orders.id` and resolves the CURRENT amendment itself —
 * the newest by amend date, then by insertion. Printing a superseded amendment
 * because someone bookmarked its id is precisely the failure a shop-floor
 * document cannot have.
 *
 * The amendment's own `code` is printed as the sheet's S No, so a sheet in
 * someone's hand can be checked against what the system holds now. NOTHING
 * HERE COMPOSES A NUMBER: the RE Number and the S No are both read off stored
 * columns and rendered character for character. See `GosHeader`.
 *
 * ## WHY EVERY QUERY CHECKS `error`
 *
 * This query carries eleven embeds. PostgREST resolves every relationship
 * before returning a row, and ONE unresolvable name fails ALL of them — which
 * `getAmendments` learned on 2026-08-11, when two embeds named tables whose
 * migrations had not been applied and `data ?? []` turned an outage into a
 * Garment Order list with no rows and nothing on screen to say why. On a
 * PRINTED sheet that failure is worse: an empty size matrix reads as an order
 * nobody has broken up yet, and there is no operator watching to disbelieve it.
 */

/** The PostgREST shape, before names are flattened. */
type Row = {
  id: string;
  code: string | null;
  is_draft: boolean;
  po_no: string | null;
  po_date: string | null;
  season: string | null;
  delivery_date: string | null;
  merchandiser_id: string | null;
  customer: { name: string } | null;
  country: { name: string } | null;
  styles: {
    sno: number;
    style_ref_no: string | null;
    article_no: string | null;
    style_description: string | null;
    description: string | null;
    po_qty: number;
    style: {
      code: string | null;
      style_name: string | null;
      unit_kind: string | null;
      approved_sample: { code: string | null } | null;
    } | null;
  }[];
  style_sizes: { style_ref_no: string | null; sno: number; size_id: string | null }[];
  combos: {
    sno: number;
    style_ref_no: string | null;
    combo: string | null;
    combo_description: string | null;
    structures: {
      sno: number;
      structure_id: string | null;
      gsm: number | null;
      gsm_tolerance: number | null;
      structure: { name: string } | null;
      components: {
        sno: number;
        coordinate_id: string | null;
        component_id: string | null;
        color_name: string | null;
        coordinate: { name: string } | null;
        component: { short_name: string } | null;
        print: { name: string } | null;
      }[];
    }[];
  }[];
  quantities: {
    sno: number;
    style_ref_no: string | null;
    is_single_style_pack: boolean;
    po_no: string | null;
    po_qty: number;
    delivery_date: string | null;
    earlier_shipment_date: string | null;
    assortment_type: { code: string | null; name: string | null } | null;
    country: { name: string } | null;
    consignee: { name: string } | null;
    assort_lines: {
      sno: number;
      style_ref_no: string | null;
      combo: string | null;
      no_of_cartons: number | null;
      inners_per_carton: number | null;
      sizes: { size_id: string | null; qty: number | null }[];
    }[];
  }[];
};

/**
 * The select string, written out rather than assembled, so the embeds a reader
 * has to check are all on one screen.
 *
 * `components:components(short_name)` is not a typo for `name` — the master has
 * `short_name` and `description` and no `name` column at all.
 */
const SELECT =
  "id, code, is_draft, po_no, po_date, season, delivery_date, merchandiser_id, " +
  "customer:customers(name), country:countries(name), " +
  "styles:garment_order_amendment_styles(sno,style_ref_no,article_no,style_description,description,po_qty," +
  "style:garment_styles(code,style_name,unit_kind,approved_sample:samples(code))), " +
  "style_sizes:garment_order_amendment_style_sizes(style_ref_no,sno,size_id), " +
  "combos:garment_order_amendment_combos(sno,style_ref_no,combo,combo_description," +
  "structures:garment_order_amendment_combo_structures(sno,structure_id,gsm,gsm_tolerance," +
  "structure:categories(name)," +
  "components:garment_order_amendment_combo_components(sno,coordinate_id,component_id,color_name," +
  "coordinate:items(name),component:components(short_name),print:config_lookups(name)))), " +
  "quantities:garment_order_amendment_quantities(sno,style_ref_no,is_single_style_pack,po_no,po_qty," +
  "delivery_date,earlier_shipment_date," +
  "assortment_type:config_lookups!garment_order_amendment_quantities_assortment_type_id_fkey(code,name)," +
  "country:countries(name),consignee:consignees(name)," +
  "assort_lines:garment_order_amendment_assort_lines(sno,style_ref_no,combo,no_of_cartons,inners_per_carton," +
  "sizes:garment_order_amendment_assort_line_sizes(size_id,qty)))";

/**
 * The Garment Order Sheet for one sales order.
 *
 * Returns a `Refusal` — never null, never a half-empty sheet — when the order
 * has no amendment to print. "This order has not been entered yet" and "the
 * query broke" must not look alike on paper.
 */
export async function getGarmentOrderSheet(
  salesOrderId: string,
): Promise<GosSheet | Refusal> {
  const s = await createClient();

  const { data: order, error: orderErr } = await s
    .from("sales_orders")
    .select("id, order_number, order_date")
    .eq("id", salesOrderId)
    .maybeSingle();
  if (orderErr) throw new Error(`Could not load the order: ${orderErr.message}`);
  if (!order) {
    return { refused: "No such order." };
  }

  // The order's amendments, oldest first. Only the LAST id is used — this
  // resolves which document is current, and nothing is derived from the
  // length: a positional "amendment 2 of 3" would be a number this code minted,
  // and it would change for an already-printed sheet the moment a third
  // amendment was raised.
  const { data: seq, error: seqErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId)
    .order("amend_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (seqErr) throw new Error(`Could not load the order's amendments: ${seqErr.message}`);

  const ids = ((seq ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) {
    return {
      refused: `Order ${order.order_number ?? salesOrderId} has no Garment Order entered against it, so there is nothing to print.`,
    };
  }
  const currentId = ids[ids.length - 1];

  const { data, error } = await s
    .from("garment_order_amendments")
    .select(SELECT)
    .eq("id", currentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the Garment Order Sheet: ${error.message}`);
  if (!data) {
    return { refused: "The Garment Order for this order could not be read." };
  }
  const row = data as unknown as Row;

  const [sizeNames, merchandiser] = await Promise.all([
    sizeNameMap(),
    profileName(row.merchandiser_id),
  ]);

  const src: GosSource = {
    amendment: {
      code: row.code,
      is_draft: row.is_draft,
      po_no: row.po_no,
      po_date: row.po_date,
      season: row.season,
      delivery_date: row.delivery_date,
      customer: row.customer?.name ?? null,
      country: row.country?.name ?? null,
      merchandiser,
    },
    order: {
      order_number: order.order_number,
      order_date: order.order_date,
    },
    styles: (row.styles ?? []).map((x) => ({
      sno: x.sno,
      style_ref_no: x.style_ref_no,
      article_no: x.article_no,
      style_description: x.style_description,
      description: x.description,
      po_qty: Number(x.po_qty) || 0,
      style_code: x.style?.code ?? null,
      style_name: x.style?.style_name ?? null,
      unit_kind: x.style?.unit_kind ?? null,
      approved_sample_no: x.style?.approved_sample?.code ?? null,
    })),
    style_sizes: row.style_sizes ?? [],
    combos: (row.combos ?? []).map((c) => ({
      sno: c.sno,
      style_ref_no: c.style_ref_no,
      combo: c.combo,
      combo_description: c.combo_description,
      structures: (c.structures ?? []).map((st) => ({
        sno: st.sno,
        structure_id: st.structure_id,
        structure: st.structure?.name ?? null,
        gsm: st.gsm == null ? null : Number(st.gsm),
        gsm_tolerance: st.gsm_tolerance == null ? null : Number(st.gsm_tolerance),
        components: (st.components ?? []).map((cm) => ({
          sno: cm.sno,
          coordinate_id: cm.coordinate_id,
          coordinate: cm.coordinate?.name ?? null,
          component_id: cm.component_id,
          component: cm.component?.short_name ?? null,
          color_name: cm.color_name,
          print: cm.print?.name ?? null,
        })),
      })),
    })),
    quantities: (row.quantities ?? []).map((q) => ({
      sno: q.sno,
      style_ref_no: q.style_ref_no,
      is_single_style_pack: q.is_single_style_pack,
      assortment_type: q.assortment_type,
      po_no: q.po_no,
      po_qty: Number(q.po_qty) || 0,
      delivery_date: q.delivery_date,
      earlier_shipment_date: q.earlier_shipment_date,
      // The COUNTRY is the destination; the consignee is the fallback for an
      // order that names a party but no market. Neither is invented — a
      // destination with neither prints its own Ref No, which is what the
      // Quantities tab shows the operator.
      destination: q.country?.name ?? q.consignee?.name ?? null,
      assort_lines: (q.assort_lines ?? []).map((l) => ({
        sno: l.sno,
        style_ref_no: l.style_ref_no,
        combo: l.combo,
        no_of_cartons: l.no_of_cartons == null ? null : Number(l.no_of_cartons),
        inners_per_carton:
          l.inners_per_carton == null ? null : Number(l.inners_per_carton),
        sizes: (l.sizes ?? []).map((z) => ({
          size_id: z.size_id,
          qty: z.qty == null ? null : Number(z.qty),
        })),
      })),
    })),
    sizeNames,
    printedAt: new Date().toISOString(),
  };

  return buildGosSheet(src);
}

/**
 * `config_lookups` kind 'size', id -> name.
 *
 * INACTIVE ROWS ARE INCLUDED. The standing "Disabled rows" rule hides a
 * switched-off row from a PICKER; this is not a picker, it is a label lookup,
 * and an order that already names a since-retired size must still print that
 * size's name rather than a uuid.
 */
async function sizeNameMap(): Promise<Record<string, string>> {
  const s = await createClient();
  const { data, error } = await s
    .from("config_lookups")
    .select("id, name")
    .eq("kind", "size");
  if (error) throw new Error(`Could not load size names: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; name: string }[]) out[r.id] = r.name;
  return out;
}

/**
 * One profile's display name, through `creator_names()`.
 *
 * NOT A POSTGREST EMBED, for the reason `lib/created-by.ts` sets out at length:
 * `profiles_read_own` lets a user select only their OWN profile row, so
 * `merchandiser:profiles(full_name)` resolves to null for every merchandiser
 * who is not the person printing the sheet. The embed compiles, runs and
 * returns a blank — which on this sheet would read as "no merchandiser
 * assigned". `creator_names()` is SECURITY DEFINER and returns id + name only.
 */
async function profileName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const s = await createClient();
  const { data } = await s.rpc("creator_names", { ids: [id] });
  const row = ((data ?? []) as { id: string; full_name: string | null }[])[0];
  return row?.full_name ?? null;
}
