import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listCategories } from "@/lib/masters/category-service";
import { listLevies } from "@/lib/masters/levy-service";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listVendorNominations, listVendorsForPicker } from "@/lib/masters/vendor-service";
import type { VendorNomination } from "@/lib/masters/vendor-nominations";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { MaterialBomAmendment, BomCopySource } from "./types";
import { isInactive } from "@/lib/masters/inactive";
import { isAccessoryClass, type MaterialOption } from "./material-options";
import { withCreators } from "@/lib/created-by";
// The order-reading half of this service moved to `bom-order-basis.ts` when
// Fabric BOM (0426) needed the same reader — see that file's header for why it
// was extracted rather than copied.
import {
  bomTaskRows,
  confirmedOrdersForBom,
  getOrderProduction,
  rejectionTiersById,
  type BomLite,
  type BomStatus,
  type BomTaskRow,
} from "@/lib/orders/bom-order-basis";

// `getOrderProduction` is re-exported because `./actions.ts` and this file are
// one module in every practical sense — moving the reader out should not make
// the actions reach past their own service for it.
export { getOrderProduction };


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
export type { BomTaskRow } from "@/lib/orders/bom-order-basis";

export async function listMaterialBomTasks(): Promise<BomTaskRow[]> {
  const s = await createClient();

  const [tiers, orders, bomsRes] = await Promise.all([
    rejectionTiersById(),
    confirmedOrdersForBom(),
    s
      .from("material_bom_amendments")
      .select(
        "id, code, garment_order_id, amendment_no, is_draft, computed_basis_hash, " +
          "computed_for_qty, items:material_bom_amendment_items(id)",
      )
      .order("amendment_no", { ascending: false }),
  ]);

  type BomRow = {
    id: string;
    code: string | null;
    garment_order_id: string | null;
    amendment_no: number;
    is_draft: boolean;
    computed_basis_hash: string | null;
    computed_for_qty: number | null;
    items: { id: string }[] | null;
  };

  // The LATEST amendment per order. The select is already ordered by
  // amendment_no descending, so the first one seen wins — a later revision is
  // what the queue should be reporting on.
  const latest = new Map<string, BomLite>();
  for (const b of (bomsRes.data ?? []) as unknown as BomRow[]) {
    if (!b.garment_order_id || latest.has(b.garment_order_id)) continue;
    latest.set(b.garment_order_id, {
      id: b.id,
      code: b.code,
      is_draft: b.is_draft,
      computed_basis_hash: b.computed_basis_hash,
      computed_for_qty: b.computed_for_qty,
      lineCount: b.items?.length ?? 0,
    });
  }

  return withCreators(bomTaskRows(orders, tiers, latest));
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
        // THE CHILD IS EMBEDDED, and this is the step 0436 never took for its
        // own child: `(*)` does NOT pull nested relations, so a table that is
        // typed, validated and carried in form state stays invisible without a
        // line here. `material_bom_amendment_item_components` has been in
        // exactly that state since 0436 — declared everywhere, selected nowhere.
        "items:material_bom_amendment_items(*, " +
        "slices:material_bom_amendment_item_slices(*)), " +
        "processes:material_bom_amendment_processes(*), " +
        /* THE CHALLANS RAISED FROM THIS BOM (0446), so the Processes tab can say
           which rows have already gone out and stop offering to send them twice.
           Reached by `dc_line_items.mba_amendment_id`, the FK that migration
           added for exactly this. */
        "dc_lines:dc_line_items(mba_process_row_uid, sent_qty, returned_qty, " +
        "delivery_challan_id, challan:delivery_challans(code, dc_date, status, stock_posted_at)), " +
        "requirements:material_bom_amendment_requirements(*)",
    )
    .order("created_at", { ascending: false });

  return withCreators(
    ((data ?? []) as unknown as MaterialBomAmendment[]).map((r) => ({
      ...r,
      // The overrides carry their own `sno` and PostgREST makes no ordering
      // promise on an embed — the same reason the three children are sorted.
      items: [...(r.items ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((it) => ({ ...it, slices: [...(it.slices ?? [])].sort((x, y) => x.sno - y.sno) })),
      processes: [...(r.processes ?? [])].sort((a, b) => a.sno - b.sno),
      requirements: [...(r.requirements ?? [])].sort((a, b) => a.sno - b.sno),
    })),
  );
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

/**
 * The materials a BOM line may name — Sewing and Packing accessories only.
 *
 * NARROWED HERE, NOT ON THE CLIENT. The option list is what the picker filters,
 * so a client-side narrowing would still ship every item id in the database to
 * the browser and only hide them. The Category cascade beside it IS a client
 * concern (it depends on a cell the operator is typing into), and it reads
 * `class_code` off these rows.
 *
 * `category_id` rides along UNRESOLVED — it is a `public.categories` id (0226)
 * and the client compares it to the BOM line's own Category, which has been the
 * same kind of value since 0426. Nothing here needs its NAME, so there is no
 * second read: the comparison is id to id.
 *
 * `item_class_id` resolves through `config_lookups` in a second query rather
 * than a PostgREST embed. Embeds resolve BY FK and fail at runtime with "could
 * not find a relationship" — invisible to `tsc` and to `next build` (see the
 * two-party-table note in AGENTS.md) — and this one column is not worth that
 * risk. Two indexed reads, joined in memory.
 *
 * `inactive` rides along and is NOT filtered in SQL: a material a saved line
 * already names must still resolve, or the cell renders empty and the next save
 * blanks the FK. The picker hides the switched-off ones itself.
 */
async function getMaterialRows(): Promise<MaterialOption[]> {
  const s = await createClient();
  const [itemsRes, classRes] = await Promise.all([
    s
      .from("items")
      // `has_alternate_uom`, `base_uom_id` and `purchase_uom_id` feed the
      // narrowed Uom cells (client 2026-08-19) — see `MaterialOption`. A
      // hand-written select that names a column the client then filters BY
      // is the half AGENTS.md keeps recording as the silent one: the cell
      // renders, the filter runs, and it matches nothing.
      .select(
        "id, code, name, is_active, item_class_id, category_id, has_alternate_uom, base_uom_id, purchase_uom_id",
      )
      .order("name"),
    s.from("config_lookups").select("id, code").eq("kind", "item_class"),
  ]);

  const classCode = new Map<string, string | null>(
    ((classRes.data ?? []) as { id: string; code: string | null }[]).map((c) => [c.id, c.code]),
  );

  type ItemRowRaw = {
    id: string;
    code: string | null;
    name: string;
    is_active: boolean;
    item_class_id: string | null;
    category_id: string | null;
    has_alternate_uom: boolean | null;
    base_uom_id: string | null;
    purchase_uom_id: string | null;
  };

  return ((itemsRes.data ?? []) as ItemRowRaw[])
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      inactive: isInactive(r),
      class_code: (r.item_class_id ? classCode.get(r.item_class_id) : null) ?? null,
      category_id: r.category_id ?? null,
      has_alternate_uom: r.has_alternate_uom ?? false,
      base_uom_id: r.base_uom_id ?? null,
      purchase_uom_id: r.purchase_uom_id ?? null,
    }))
    .filter((r) => isAccessoryClass(r.class_code));
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
  /** The styles this order carries, for the line-level Style picker. */
  styles: BomOrderStyle[];
};

/**
 * A style line as the BOM needs it — its ref, and the two facts the module
 * fetches from Style Entry (0423).
 *
 * Until 0423 this was a bare `string[]` of refs, and it was the whole of what
 * the Material BOM knew about a style: the module never touched
 * `garment_styles` at all. So it could not say which panel a trim goes on, and
 * it could not tell a Set from a Piece.
 */
export type BomOrderStyle = {
  ref: string;
  /**
   * `piece` / `set` from the Style master, DISPLAYED and never computed with.
   *
   * The client asked the BOM to "know if the style is a Piece or a Set". It
   * makes the difference to `per_pieces` — "1 per piece" on a two-garment Set
   * means something different from "1 per piece" on a single top — but the
   * divisor is typed by the operator and stays that way. Turning it into
   * arithmetic would silently double or halve a requirement the operator
   * thought they had entered, which is the failure the whole `Refusal` shape in
   * requirement.ts exists to avoid. Shown beside the Style so the number is
   * entered knowingly.
   */
  unit_kind: string | null;
  /** The panels this style declares, for the line's Component cell (0423). */
  components: { id: string; code: string | null; name: string; inactive: boolean }[];
};

async function getOrderOptions(): Promise<BomOrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_order_amendments")
    .select(
      "id, code, po_no, amend_date, delivery_date, " +
        "customer:customers(id,name), sales_order:sales_orders(order_number), " +
        // `style_id` as well as the ref (0423): the ref is what every child
        // table keys on, but only the id reaches the Style master.
        "styles:garment_order_amendment_styles(style_ref_no, style_id)",
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as {
    id: string;
    code: string | null;
    po_no: string | null;
    amend_date: string;
    delivery_date: string | null;
    customer: { id: string; name: string } | null;
    sales_order: { order_number: string | null } | null;
    styles: { style_ref_no: string | null; style_id: string | null }[] | null;
  }[];

  /**
   * THE STYLE STRUCTURE, in two more reads rather than one deep embed.
   *
   * `garment_styles` cannot be embedded from here: PostgREST resolves an embed
   * BY FK and fails the WHOLE query when it cannot — at RUNTIME, invisible to
   * `tsc` and to the build. `lib/orders/amendments/service.ts` records what that
   * costs: one unresolvable name emptied the Style picker with no error at all.
   * Two indexed reads joined in memory cannot fail that way.
   *
   * Skipped entirely when no style line names a style, which is the state a
   * brand-new order is in.
   */
  const styleIds = [
    ...new Set(
      rows.flatMap((o) => (o.styles ?? []).map((x) => x.style_id).filter(Boolean) as string[]),
    ),
  ];

  const [styleRes, compRes] = await Promise.all([
    styleIds.length
      ? s
          .from("garment_styles")
          .select("id, unit_kind, components:garment_style_components(component_id)")
          .in("id", styleIds)
      : Promise.resolve({ data: [] as unknown[] }),
    styleIds.length
      // `inactive`, NOT `blocked` (fixed 2026-08-17 while building Fabric BOM).
      // 0299 renamed this column and the select was never updated. PostgREST
      // answers a select over a MISSING column with an ERROR rather than nulls,
      // so `compRes.data` was empty on every call and the Material BOM's
      // Component cell (0423) offered nothing — it read as "this style declares
      // no components", which is a real and unremarkable state, so it got
      // believed rather than reported.
      //
      // This is the SECOND time this exact column on this exact table has done
      // this: `lib/masters/inactive.ts` records the Style screen's Component
      // dropdown going silently blank the same way, and says to read the column
      // from the catalog rather than from memory. Doing that is what found it.
      ? s.from("components").select("id, short_name, inactive")
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const componentById = new Map(
    ((compRes.data ?? []) as { id: string; short_name: string; inactive: boolean }[]).map((c) => [
      c.id,
      { id: c.id, code: null, name: c.short_name, inactive: c.inactive },
    ]),
  );

  const structureById = new Map(
    (
      (styleRes.data ?? []) as unknown as {
        id: string;
        unit_kind: string | null;
        components: { component_id: string | null }[] | null;
      }[]
    ).map((g) => [
      g.id,
      {
        unit_kind: g.unit_kind,
        // De-duplicated: a style may list one component under two coordinates
        // (a POCKET on the top and on the bottom of a Set), and the BOM asks
        // which PART a trim goes on, not which coordinate.
        components: [
          ...new Map(
            (g.components ?? [])
              .map((c) => (c.component_id ? componentById.get(c.component_id) : null))
              .filter(Boolean)
              .map((c) => [c!.id, c!] as const),
          ).values(),
        ],
      },
    ]),
  );

  return rows.map((o) => ({
    id: o.id,
    code: o.code,
    sc_no: o.sales_order?.order_number ?? null,
    po_no: o.po_no,
    customer_id: o.customer?.id ?? null,
    customer_name: o.customer?.name ?? null,
    amend_date: o.amend_date,
    delivery_date: o.delivery_date,
    styles: (o.styles ?? [])
      .filter((x) => (x.style_ref_no ?? "").trim())
      .map((x) => {
        const st = x.style_id ? structureById.get(x.style_id) : undefined;
        return {
          ref: x.style_ref_no as string,
          unit_kind: st?.unit_kind ?? null,
          components: st?.components ?? [],
        };
      }),
  }));
}

export type MbaFormData = {
  orders: BomOrderOption[];
  customers: Customer[];
  items: MaterialOption[];
  vendors: PickerRow[];
  /** Every customer's nominated / recommended vendors — see `VendorNomination`. */
  nominations: VendorNomination[];
  processes: PickerRow[];
  /** Where goods physically leave from, for a Delivery Challan raised off the
   *  Processes tab (0446). */
  locations: { id: string; code: string; name: string }[];
  uoms: UomRow[];
  conversions: MbaConversionRow[];
  /**
   * The REAL Category master (0426), already scoped to the two accessory item
   * classes. NOT `config_lookups` kind `material_category` — those two rows are
   * the GROUP names, which is the bug 0426 fixed.
   *
   * Both classes arrive in ONE list because a BOM line has no item class of its
   * own: one grid holds a button and a poly bag. The screen prefixes each option
   * by its class, since category names repeat across classes (AGENTS.md,
   * cascading filters).
   */
  categories: Category[];
  /** For the Category quick-create sheet only — `CategoryPicker` opens the full
   *  mini-child rather than a name-only add when this is supplied. */
  levies: Levy[];
  lookups: ConfigLookup[];
};

/**
 * Categories under Sewing Accessory and Packing Accessory, in one list.
 *
 * SCOPED BY CLASS **CODE**, never by name — the same resolution
 * `app/(app)/masters/[submodule]/[entity]/page.tsx` uses for Customer ▸ Supplied
 * Items. A class renamed on the Item Class master would silently empty this list
 * if it were matched by name, and an empty Category dropdown reads as "the
 * master has nothing in it" rather than "the lookup broke".
 *
 * `inactive` categories are dropped here rather than in SQL only for the NEW
 * ones; a category a saved line already holds is re-admitted by the screen, the
 * same way `getMaterialRows` leaves switched-off materials for the picker to
 * handle.
 */
function accessoryCategoriesFrom(all: Category[], lookups: ConfigLookup[]): Category[] {
  const classIds = new Set(
    lookups
      .filter((l) => l.kind === "item_class" && isAccessoryClass(l.code))
      .map((l) => l.id),
  );
  return all.filter((c) => c.item_class_id && classIds.has(c.item_class_id));
}

/** Every picker option list the editor needs, fetched in parallel. */
/** Active locations, for a challan's "despatched from". Same shape the DC form
 *  already uses (`grn-service.getLocations`), fetched here so the BOM screen
 *  does not have to reach into the purchase service. */
async function getLocationRows(): Promise<{ id: string; code: string; name: string }[]> {
  const s = await createClient();
  const { data } = await s
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string }[];
}

export async function getMbaFormData(): Promise<MbaFormData> {
  const [
    orders,
    customers,
    items,
    vendors,
    nominations,
    processes,
    locations,
    uoms,
    conversions,
    allCategories,
    levies,
    lookups,
  ] = await Promise.all([
    getOrderOptions(),
    listCustomers(),
    getMaterialRows(),
    getVendorRows(),
    listVendorNominations(),
    getProcessRows(),
    getLocationRows(),
    getUomRows(),
    getConversionRows(),
    listCategories(),
    listLevies(),
    listConfigLookups(),
  ]);
  return {
    orders,
    customers,
    items,
    vendors,
    nominations,
    processes,
    locations,
    uoms,
    conversions,
    // Scoped AFTER the fetch because the class ids come out of `lookups`, which
    // is fetched in the same batch — one round trip, not two chained ones.
    categories: accessoryCategoriesFrom(allCategories, lookups),
    levies,
    lookups,
  };
}
