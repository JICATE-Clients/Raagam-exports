import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import { listCurrencies } from "@/lib/masters/service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listPaymentTerms } from "@/lib/masters/payment-term-service";
import { listCategories } from "@/lib/masters/category-service";
import type { Category } from "@/lib/masters/category-types";
import { paymentTermsAsLookups } from "@/lib/masters/lookup-compat";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { ProcessOption } from "./style-processes";
import type { RejectionTier } from "@/lib/masters/rejection-rule";
import type { GarmentOrderAmendment } from "./types";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import type { ComponentScopeRow } from "@/lib/masters/component-coordinates";
/* TYPE ONLY — erased at compile time, so naming it here does not pull the
   Style master's server module into this bundle. See `getApprovedSampleRows`. */
import type { SamplePickerRow } from "@/lib/orders/styles/service";
import type { MixingShare } from "./combo-rules";
import { listCompositionsForPicker, type CompositionPickerRow } from "@/lib/masters/composition-service";
import { withCreators } from "@/lib/created-by";

/** A row normalized to {id, code, name} for a RecordPicker. */
/**
 * The disable flag rides along (optional, and in any of the schema's three
 * spellings) so a picker can hide a retired buyer / user / UOM while an
 * amendment that already names one still resolves it. Several lists on this
 * screen — contacts, colour-card colours — come off flag-less tables and simply
 * omit it.
 */
export type PickerRow = { id: string; code: string | null; name: string } & Deactivatable;

/**
 * A consignee, plus the customer it belongs to (0427-era client ask).
 *
 * A `PickerRow` with one extra field rather than a reshaped one: it is still
 * handed straight to `RecordPicker`, and every other consumer keeps working
 * because the extra key is additive. The scoping rule that reads it lives on
 * the screen (`consigneeOptions`), which is where the order's customer is.
 */
export type ConsigneeRow = PickerRow & { customer_id: string | null };

/**
 * A FABRIC material, plus the category it sits in (0430).
 *
 * The same shape of extension as `ConsigneeRow` above, and for the same reason:
 * it is still handed straight to `RecordPicker`, and the scoping rule that reads
 * the extra key lives on the SCREEN, which is where the picked Structure is.
 * `name` is already the composition — see `getFabricRows`.
 */
export type FabricRow = PickerRow & {
  category_id: string | null;
  /**
   * The fabric's blend, reduced to what `compositionForStructure()` matches on
   * (0434). The type is imported from `combo-rules.ts` rather than restated
   * here on purpose: the feeder and the rule then fail to COMPILE if they ever
   * drift, instead of silently agreeing on nothing at runtime.
   */
  mixing: MixingShare[];
};

/**
 * An order row for the SCNo picker. Carries the order's buyer / currency /
 * delivery date so the client can auto-load the amendment header when an SCNo is
 * selected — no extra round trip (confirmed behaviour: SCNo loads the order).
 */
export type OrderPickerRow = {
  id: string;
  order_number: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  currency_code: string | null;
  ship_date: string | null;
};

/** All amendments with embedded order/buyer + child grids. */
export async function getAmendments(): Promise<GarmentOrderAmendment[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_order_amendments")
    .select(
      "*, sales_order:sales_orders(id,order_number,location_id), " +
        "customer:customers(id,code,name), " +
        "charges:garment_order_amendment_charges(*), " +
        "style_prices:garment_order_amendment_style_prices(*), " +
        "styles:garment_order_amendment_styles(*), " +
        "style_sizes:garment_order_amendment_style_sizes(*), " +
        // The coordinates a component is filed under (0461), and the
        // Style master's component list (0457), both merged into Order Info.
        "style_coordinates:garment_order_amendment_style_coordinates(*), " +
        // Retail SET pack members (0467), the fifth of the style-keyed family.
        "pack_components:garment_order_amendment_pack_components(*), " +
        // The Style master's component list, merged into Order Info (0457).
        "style_components:garment_order_amendment_style_components(*), " +
        "style_processes:garment_order_amendment_style_processes(*), " +
        "dyeings:garment_order_amendment_dyeings(*), " +
        "prints:garment_order_amendment_prints(*), " +
        "structures:garment_order_amendment_structures(*), " +
        // The combo TREE (0408). Two levels of embed, so PostgREST resolves
        // structures under each combo and components under each structure —
        // and, like every other name here, ONE unresolvable relationship fails
        // the whole query rather than this branch of it.
        "combos:garment_order_amendment_combos(*, structures:garment_order_amendment_combo_structures(*, components:garment_order_amendment_combo_components(*))), " +
        "price_details:garment_order_amendment_price_details(*), " +
        "approval_qtys:garment_order_amendment_approval_qtys(*), " +
        "pack_types:garment_order_amendment_pack_types(*), " +
        // What each pack type PACKS (0472) — a flat sibling, not an embed
        // under `pack_types`, because it is keyed to its parent by
        // `pack_type` TEXT and PostgREST can only nest across a real FK.
        // The screen re-nests it; `style_sizes` above is the same shape.
        "pack_type_lines:garment_order_amendment_pack_type_lines(*), " +
        // The Assort tree (0414). Two levels of embed under the quantity row —
        // and, like every other name here, ONE unresolvable relationship
        // fails the WHOLE query rather than this branch of it, which is why
        // this lands in the same edit as the migration.
        "quantities:garment_order_amendment_quantities(*, assort_lines:garment_order_amendment_assort_lines(*, sizes:garment_order_amendment_assort_line_sizes(*))), " +
        "country_sizes:garment_order_amendment_country_sizes(*), " +
        // The attached documents (0416) — the style JPG, the buyer's PDF order
        // sheet, shade cards. Metadata only; the bytes live in the private
        // `garment-order-docs` bucket and `storage_path` is the key.
        "files:garment_order_amendment_files(*)",
    )
    .order("created_at", { ascending: false });

  /**
   * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — the same rule `getStyleRows`
   * below already carries, and this is the function it was missed on.
   *
   * FOURTEEN EMBEDS, so this is the query in the module most able to fail
   * wholesale: PostgREST resolves every relationship before returning a row, and
   * ONE unresolvable name fails all of them. That is not hypothetical
   * (2026-08-11) — the `quantities` and `pack_types` embeds named tables whose
   * migrations had not been applied, PostgREST answered 400 / PGRST200, and
   * `data ?? []` turned it into a Garment Order list with no rows, no error and
   * nothing on screen to say the schema was behind the code. It read exactly
   * like "there are no orders yet".
   */
  if (error) {
    throw new Error(`Could not load garment orders: ${error.message}`);
  }

  const bySno = <T extends { sno: number }>(rows: T[] | undefined): T[] =>
    [...(rows ?? [])].sort((a, b) => a.sno - b.sno);

  return withCreators(((data ?? []) as unknown as GarmentOrderAmendment[]).map((r) => ({
    ...r,
    charges: bySno(r.charges),
    style_prices: bySno(r.style_prices),
    styles: bySno(r.styles),
    style_sizes: bySno(r.style_sizes),
    style_coordinates: bySno(r.style_coordinates),
    pack_components: bySno(r.pack_components),
    style_components: bySno(r.style_components),
    style_processes: bySno(r.style_processes),
    dyeings: bySno(r.dyeings),
    prints: bySno(r.prints),
    structures: bySno(r.structures),
    combos: bySno(r.combos).map((c) => ({
      ...c,
      structures: bySno(c.structures).map((st) => ({ ...st, components: bySno(st.components) })),
    })),
    price_details: bySno(r.price_details),
    approval_qtys: bySno(r.approval_qtys),
    pack_types: bySno(r.pack_types),
    pack_type_lines: bySno(r.pack_type_lines),
    quantities: bySno(r.quantities).map((q) => ({
      ...q,
      // Size cells have no `sno` — the ORDER of a ratio is the column order,
      // which the screen derives from the style's sizes, so they are left as
      // they come and looked up by `size_id`.
      assort_lines: bySno(q.assort_lines).map((l) => ({ ...l, sizes: l.sizes ?? [] })),
    })),
    country_sizes: bySno(r.country_sizes),
  })));
}

/** Confirmed sales orders for the SCNo picker (+ context for auto-load). */
async function getOrderRows(): Promise<OrderPickerRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("sales_orders")
    .select("id, order_number, buyer_id, currency_code, ship_date, buyers(name)")
    .order("created_at", { ascending: false });
  // Embeds `buyers`, so it fails wholesale the same way — and an empty return here
  // is an SCNo picker with nothing to pick, which is precisely the shape the
  // Style picker failed in before `getStyleRows` was fixed.
  if (error) throw new Error(`Could not load orders for the SCNo picker: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    order_number: string | null;
    buyer_id: string | null;
    currency_code: string | null;
    ship_date: string | null;
    buyers?: { name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    order_number: r.order_number,
    buyer_id: r.buyer_id,
    buyer_name: r.buyers?.name ?? null,
    currency_code: r.currency_code,
    ship_date: r.ship_date,
  }));
}

/**
 * THE FLAT PICKER QUERIES BELOW DELIBERATELY DO NOT CHECK `error`.
 *
 * The rule the four checked queries follow is narrow: a query carrying an EMBED
 * fails wholesale when one relationship cannot be resolved, so `data ?? []`
 * converts a schema fault into an empty list that reads as "no rows yet". A flat
 * `select("id, code, name")` has no relationship to break — it fails only if the
 * table itself is gone, which takes the page down anyway.
 *
 * Left as a follow-up rather than swept, so the distinction stays legible: if
 * one of these ever grows an embed, it needs the check at the same moment.
 */

/**
 * Customers for the "Customer" picker (the order's party).
 *
 * IT READS THE CUSTOMER MASTER NOW (0404). It used to read `buyers`, the
 * scaffold's thin party table — so the field said "Customer", stored a buyer,
 * and offered four DEMO rows beside the two real ones while ASMARA and OXBOW,
 * entered on the Customer master, could not be picked at all (client
 * 2026-08-11, from the screen).
 *
 * `inactive` rides along and is NOT filtered in SQL: a customer a saved order
 * already names must still resolve, or the field renders empty and the next save
 * blanks the FK ("Disabled rows"). The picker hides the switched-off ones itself.
 *
 * This also unblocks the Style picker's customer half — `garment_styles.customer_id`
 * points at `customers` too, so the two finally key on one table. Turning that
 * narrowing on is a separate, deliberate change; see `style-options.ts`.
 */
async function getCustomerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("customers")
    .select("id, code, name, inactive")
    .order("name");
  return (data ?? []) as PickerRow[];
}

/**
 * The three masters the Quantities grid points at (0398).
 *
 * `is_active` / `inactive` ride along and are NOT filtered in SQL — a row a
 * saved quantity already references must still resolve, or the field renders
 * empty and the next save blanks the FK ("Disabled rows"). The picker hides the
 * switched-off ones itself.
 *
 * WareHouse is `stores`, not the `warehouse` config_lookups kind: that kind
 * exists in the CHECK and holds no rows, while `stores` is the live master.
 * Pointing at the empty one would reproduce the defect 0396 just fixed.
 */
/**
 * Consignees, WITH THE CUSTOMER THEY BELONG TO.
 *
 * `customer_id` is selected so the Quantities grid can narrow the list to the
 * order's own customer (client 2026-08-17: "the consignee input should be
 * filtered based on the specific buyer/customer selected for that order").
 *
 * THE DATA HALF IS THE HALF THAT GETS MISSED — the same shape as the
 * `created_by` sweep and the item-report filter bar in AGENTS.md: a screen
 * cannot scope by a column its service never asked for, and the symptom is a
 * facet that silently narrows to nothing (or to everything) rather than an
 * error. Narrowing in SQL would be the OTHER half of the same mistake: a
 * consignee a saved quantity already names must still resolve, whoever the
 * order is for, or the cell renders empty and the next save blanks the FK.
 *
 * NOT `source_customer_id`, which records where a published copy CAME from
 * (0371's party-publishing). `customer_id` is the link the Customer master
 * maintains, and it is the one an operator would recognise.
 */
async function getConsigneeRows(): Promise<ConsigneeRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("consignees")
    .select("id, code, name, inactive, customer_id")
    .order("name");
  return (data ?? []) as ConsigneeRow[];
}

async function getWarehouseRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("stores").select("id, code, name").order("name");
  return (data ?? []) as PickerRow[];
}

async function getPortRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("ports")
    .select("id, code, name, inactive")
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** App users for the "Merchand." picker. */
async function getMerchandiserRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("profiles")
    .select("id, employee_code, full_name, is_active")
    .order("full_name");
  return ((data ?? []) as {
    id: string;
    employee_code: string | null;
    full_name: string | null;
    is_active: boolean;
  }[]).map((r) => ({
    id: r.id,
    code: r.employee_code,
    name: r.full_name ?? "(unnamed)",
    is_active: r.is_active,
  }));
}

/**
 * Contacts for the Logistic "Contact" picker. NOTE: buyers have no contact
 * master (only email/phone) — this lists all customer_contacts unscoped. See
 * doc/masters-open-questions.md for the scoping open question.
 */
async function getContactRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("customer_contacts")
    .select("id, contact_name")
    .order("contact_name");
  return ((data ?? []) as { id: string; contact_name: string | null }[]).map((r) => ({
    id: r.id,
    code: null,
    name: r.contact_name ?? "(unnamed contact)",
  }));
}

/**
 * A garment_style for the Style(s) tab picker. Carries article_no / category /
 * description so picking a Style auto-fills those columns (like the legacy screen).
 */
export type StylePickerRow = {
  id: string;
  code: string | null;
  name: string;
  article_no: string | null;
  style_category: string | null;
  style_description: string | null;
  /**
   * SELECTED AND CARRIED, BUT NOT FILTERED ON — deliberately, and not a TODO to
   * close without fixing the data first.
   *
   * A `public.customers` row. The order header's "Customer" is a `buyers` row,
   * and the `buyers.customer_id` bridge (0380) is nullable and set for NONE of
   * the 6 buyers in the database — so any filter over it either shows no styles
   * at all or silently shows every style. `style-options.ts` carries the full
   * account and what unblocks it. Kept here so turning the filter on is a small
   * edit once the bridge is filled.
   */
  customer_id: string | null;
  /**
   * The column the Style picker DOES narrow on (`styleOptions`). Free text
   * (0124), compared trimmed and case-folded; nullable, and a null means
   * "unassigned" rather than excluded.
   */
  season: string | null;
  /**
   * PIECE OR SET — the line's Order Unit (`garment_styles.unit_kind`, 0392).
   *
   * The one unit question a garment order asks (client 2026-08-11: "Order Unit
   * (PCS/SET) is sufficient"), and the same value that caps the style's
   * Coordinates grid. Rendered through `orderUnitLabel`; NULL on every style
   * predating 0392 and shown blank rather than guessed.
   */
  unit_kind: string | null;
  /**
   * The style's old Stock Unit (`garment_styles.unit_id` -> `uoms`).
   *
   * FROZEN, NOT REMOVED. It seeded the Order Unit and the Plan Unit while both
   * were `uoms` pickers; the client withdrew Plan Unit and replaced Order Unit
   * with `unit_kind` above, and the Style screen withdrew the field that FILLS
   * this on 2026-08-11 — so it is null on every style entered from now on. It
   * stays selected because `pickStyle` still seeds the two FK columns from it:
   * `writeChildren` deletes and reinserts a grid wholesale, so a column dropped
   * from the payload is NULLED on the next save rather than left alone.
   */
  unit_id: string | null;
  /** Free-text remarks from Style Entry; seeds the line's Description. */
  description: string | null;
  /** `garment_styles` spells its disable flag `blocked` (0124). */
  blocked: boolean;
  /**
   * THE STYLE'S OWN SIZE SET, in `sno` order — what `pickStyle` lists in the
   * nested Size grid under the line (0407, legacy screenshots 2255 -> 2256).
   *
   * `garment_style_sizes.size_id` -> `config_lookups` kind 'size', which the
   * screen already holds in `data.lookups`, so only the ids travel: resolving a
   * name here would be a second copy of a list the form already has.
   *
   * OFTEN EMPTY, AND THAT IS NOT AN ERROR. Filling a style's sizes is optional
   * on the Style master ("Fill sizes" from a Size Group is a button, not a
   * requirement), so an empty array means "this style has not said", and the
   * screen says so rather than showing a blank grid.
   */
  sizes: { sno: number; size_id: string | null }[];
  /**
   * THE PARTS THIS STYLE IS MADE OF — `garment_style_components` (0124/0396).
   *
   * "Component Name: pulled from the Style Entry" (client 2026-08-12). The
   * Combos ▸ Detail grid asks which coordinate and component a fabric is used
   * for, and the answer can only be one the STYLE declares — a PO cannot
   * specify the colour of a sleeve on a style that has no sleeve.
   *
   * The pair is what travels, not two lists: the style declares FRONT BODY *of
   * PIECES*, so picking the coordinate narrows the components to the ones that
   * belong to it. Flattening to two independent lists would offer a collar
   * under a coordinate that has none.
   */
  /**
   * THE STYLE MASTER'S HEADER FIELDS (0461), carried so `pickStyle` can seed the
   * order line with them. `style_category_id` sits beside the `style_category`
   * NAME above: the order stores both, and the id is the one a picker resolves.
   */
  approved_sample_id: string | null;
  style_category_id: string | null;
  /** What a component is a part of (0461) — `garment_style_coordinates`. */
  coordinates: { sno: number; coordinate_id: string | null }[];
  components: {
    sno: number;
    coordinate_id: string | null;
    component_id: string | null;
    /** The component's Structure — a fabric CATEGORY (0405). */
    fabric_category_id: string | null;
    /**
     * "Type" and "Fabric" — neither has a cell on either screen, and both are
     * carried BECAUSE OF THAT (0457).
     *
     * `pickStyle` copies this list onto the order, and Order Info's Components
     * grid writes it back on every save through a wholesale delete-and-reinsert.
     * A field the copy cannot express is a value the order's first save NULLS
     * rather than freezes — which is the difference between hiding a column and
     * destroying it, and the reason the Style master's own row shape carries
     * both under withdrawn cells.
     */
    comp_type: string | null;
    item_id: string | null;
  }[];
};

/**
 * NO COLOUR OPTION LIST IS FETCHED HERE ANY MORE (0403).
 *
 * `DyeColorRow` and `getDyeColorRows()` fed the Color/Print tab's Colour
 * pickers out of `color_card_colors`, the app's only colour data. Colour Cards
 * was withdrawn as a screen on 2026-08-11, so that list could only ever be
 * empty and unfillable — the cell is free text now and needs no options. The
 * TABLES are untouched (0403's header says why); this drops the query, not the
 * data.
 */
/** Garment styles for the Style(s) tab picker (+ context for auto-fill). */
async function getStyleRows(): Promise<StylePickerRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_styles")
    .select(
      "id, code, style_name, article_no, style_description, description, customer_id, season, unit_kind, unit_id, blocked, " +
        // 0461 merged the master's header fields onto the order line, so the
        // pick has to carry them. `style_category_id` beside the embedded
        // NAME: the order stores both, the id being the one a picker resolves.
        "approved_sample_id, style_category_id, " +
        // `categories`, NOT `config_lookups`. 0394 repointed
        // `garment_styles.style_category_id` at the Garment master and left the
        // constraint NAME unchanged, so this embed kept naming a relationship
        // that no longer exists — PostgREST could not resolve it and failed the
        // WHOLE query. With the error swallowed below that surfaced as an empty
        // Style picker on the amendment screen: nothing to pick, no error, and
        // the Style(s) tab simply unusable.
        "category:categories!garment_styles_style_category_id_fkey(name), " +
        // The style's size set (0407). A CHILD EMBED, so it fails the same
        // wholesale way the category one did: one unresolvable name and the
        // whole query returns nothing. `garment_style_sizes` is 0124's and has
        // never been repointed (0396 left it alone), so the relationship is the
        // plain FK — but the `if (error) throw` below is what makes a future
        // break visible instead of emptying the picker.
        "sizes:garment_style_sizes(sno, size_id), " +
        // The style's own parts, for the Combos ▸ Detail pickers (2026-08-12).
        "components:garment_style_components(sno, coordinate_id, component_id, fabric_category_id, comp_type, item_id), " +
        // What a component is a part of (0461). A CHILD EMBED, so it fails
        // the same wholesale way the category one did: one unresolvable name
        // and the whole query returns nothing.
        "coordinates:garment_style_coordinates(sno, coordinate_id)",
    )
    .order("created_at", { ascending: false });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — the same rule commit 37fcde8
  // applied to the Style master, and the reason the defect above went unseen for
  // as long as it did. `data ?? []` turns a broken relationship into a picker
  // that looks merely unpopulated.
  if (error) throw new Error(`Could not load styles for the picker: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    style_name: string | null;
    article_no: string | null;
    style_description: string | null;
    description: string | null;
    customer_id: string | null;
    season: string | null;
    unit_kind: string | null;
    unit_id: string | null;
    blocked: boolean;
    approved_sample_id: string | null;
    style_category_id: string | null;
    coordinates?: { sno: number | null; coordinate_id: string | null }[] | null;
    category?: { name: string } | null;
    sizes?: { sno: number | null; size_id: string | null }[] | null;
    components?: {
      sno: number | null;
      coordinate_id: string | null;
      component_id: string | null;
      fabric_category_id: string | null;
      comp_type: string | null;
      item_id: string | null;
    }[] | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.style_name ?? "(unnamed style)",
    article_no: r.article_no,
    style_category: r.category?.name ?? null,
    style_description: r.style_description,
    customer_id: r.customer_id,
    season: r.season,
    unit_kind: r.unit_kind,
    unit_id: r.unit_id,
    description: r.description,
    blocked: r.blocked,
    // Sorted HERE rather than in the query: PostgREST cannot order an embedded
    // resource independently of its parent, and the size list is the one thing
    // on this row whose ORDER is the data (2, 3, 4 ... 14, not 10 before 2).
    approved_sample_id: r.approved_sample_id,
    style_category_id: r.style_category_id,
    sizes: [...(r.sizes ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((x) => ({ sno: x.sno ?? 0, size_id: x.size_id })),
    // Sorted here for the same reason the sizes are: PostgREST cannot order an
    // embedded resource independently of its parent, and a coordinate list is
    // read in the order it was entered.
    coordinates: [...(r.coordinates ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((x) => ({ sno: x.sno ?? 0, coordinate_id: x.coordinate_id })),
    components: [...(r.components ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((x) => ({
        sno: x.sno ?? 0,
        coordinate_id: x.coordinate_id,
        component_id: x.component_id,
        fabric_category_id: x.fabric_category_id,
        comp_type: x.comp_type,
        item_id: x.item_id,
      })),
  }));
}

/**
 * Units of measure — FETCHED BUT NO LONGER READ BY THE SCREEN (2026-08-11).
 *
 * It fed the Order Unit and Plan Unit pickers. Plan Unit was withdrawn and
 * Order Unit became PCS/SET off the style's `unit_kind`, so nothing on the
 * amendment screen looks at `data.uoms` any more.
 *
 * KEPT, not deleted, because `uoms` is still what `order_unit_id` and
 * `plan_unit_id` point AT — those columns and their rows are frozen, not
 * dropped, and the next screen that needs to render one has its list here. It
 * is one small indexed read. Delete it and the field together, or not at all.
 */
async function getUomRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name, is_active")
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** Units the SC No is numbered under. `is_active` selected, never filtered. */
async function getLocationRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("locations")
    .select("id, code, name, is_active")
    .order("code");
  return (data ?? []) as PickerRow[];
}

/** A rejection rule as the picker and the calculation both need it (0413). */
export type RejectionRuleOption = {
  id: string;
  /** `effective_from` — these are versioned, so the date tells revisions apart. */
  code: string | null;
  name: string;
  /** 0264's disable flag. `isInactive()` reads this spelling. */
  blocked: boolean;
  tiers: RejectionTier[];
};

export type AmendmentFormData = {
  orders: OrderPickerRow[];
  customers: PickerRow[];
  merchandisers: PickerRow[];
  contacts: PickerRow[];
  countries: Country[];
  currencies: Currency[];
  lookups: ConfigLookup[];
  /**
   * The Payment Term MASTER (0242), reshaped by `paymentTermsAsLookups`, NOT
   * `lookups.filter(kind === 'payment_term')` — 0375 repointed
   * `garment_order_amendments.pay_terms_id` at `public.payment_terms` and
   * deleted the lookup rows, which are now a shape without a table.
   */
  paymentTerms: ConfigLookup[];
  /**
   * Credit days, by payment term id — the Logistic tab's "Days" (client
   * 2026-08-12).
   *
   * A MAP RIDING ALONGSIDE rather than a widened `ConfigLookup`, exactly as
   * `rejectionRules` carries its `tiers` and `categories` its
   * `fabric_structure_id`. `paymentTermsAsLookups()` flattens the master onto a
   * lookup shape with nowhere to put `credit_days`, and widening that shape
   * would reach all six `PaymentTermPicker` call sites to serve one screen.
   *
   * Days is DERIVED and read-only. The term already states its own credit
   * period (`payment_terms.credit_days`, 0242), so a second copy stored on the
   * order is a copy that can disagree with it — and the operator would have no
   * way to tell which one the invoice will follow.
   */
  paymentTermDays: Record<string, number>;
  styles: StylePickerRow[];
  uoms: PickerRow[];
  /** Style(s) ▸ Process (0411). Unfiltered; Type narrows it client-side. */
  processes: ProcessOption[];
  /** Approval Qty ▸ Projection (0413). Tiers ride along — see the feeder. */
  rejectionRules: RejectionRuleOption[];
  /** Quantities grid (0398), carrying the customer each one belongs to so the
   *  grid can scope the list to the order's customer — see the feeder. */
  consignees: ConsigneeRow[];
  warehouses: PickerRow[];
  ports: PickerRow[];
  /**
   * The Unit the SC No is numbered under — 0395 counts per (location, fiscal
   * year). `is_active` is SELECTED and not filtered in SQL, so `RecordPicker`
   * can hide switched-off units while still resolving one an existing order
   * already holds ("Disabled rows": filtering in SQL satisfies half the rule
   * and breaks the other half).
   */
  locations: PickerRow[];
  /**
   * Combos ▸ Structure Details (0408 · 0409) — the four lists that overlay picks
   * from, and every one of them is a MASTER rather than a lookup kind.
   *
   * `categories` carries `fabric_structure_id`, which is not decoration: it is
   * how the screen derives the knit family from the picked Structure and so how
   * `structureProblems` decides that GSM is compulsory. Selecting the id and not
   * the family is what would leave that rule unenforceable — the same "the
   * column half passing says nothing about whether the value arrived" shape the
   * `created_by` and cascade-filter sweeps both record.
   */
  categories: Category[];
  /**
   * THE FABRICS behind a structure. No longer an option list of its own (0434):
   * nothing picks a fabric on this screen any more. It is the DERIVATION'S
   * INPUT — `compositionForStructure()` reads `category_id` to find the
   * structure's sole fabric and `mixing` to read its blend.
   */
  fabrics: FabricRow[];
  /**
   * THE COMPOSITION MASTER (0434) — what the Composition cell picks from, and
   * what the derivation matches against. The whole active list, deliberately
   * NOT narrowed by the picked Structure: a composition is a property of the
   * fabric, not of the category, so narrowing would need the same derivation
   * and would offer at most the row it had already pre-selected — which is the
   * dead end ("Pick a Structure first") this replaced.
   */
  compositions: CompositionPickerRow[];
  /**
   * Approved samples for the style line's "Approved Sample No" (0461).
   *
   * `customer_id` rides along so the cell can narrow to the order's customer;
   * see `getApprovedSampleRows`. Empty in this database, which is why the field
   * is optional.
   */
  samples: SamplePickerRow[];
  /** A COORDINATE IS A GARMENT (0396) — `items` of class GAR. */
  coordinates: PickerRow[];
  /**
   * The `components` master (0228/0396), not the empty lookup kind.
   *
   * `ComponentScopeRow` rides along so Order Info's Components grid can narrow
   * Component by the Coordinate beside it — see `getComponentPickerRows`. Still
   * a `PickerRow`, so nothing that only wanted id/name had to change.
   */
  componentRows: (PickerRow & ComponentScopeRow)[];
};

/**
 * Coordinates — `items` of class GAR (0396).
 *
 * The class filter is done HERE, not in the screen: the cascading-picker rule
 * puts the narrowing at the layer that knows the class, and an item named
 * "PIECES" in some other class would otherwise be offered and be wrong.
 *
 * `is_active` rides along rather than being filtered in SQL — "Disabled rows":
 * filtering here satisfies half the rule and breaks the other half, because a
 * coordinate a saved row already holds would then resolve to nothing and blank
 * itself on the next save.
 */
async function getCoordinateRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data: classes } = await s
    .from("config_lookups")
    .select("id, code")
    .eq("kind", "item_class");
  const garIds = new Set(
    ((classes ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "GAR")
      .map((c) => c.id),
  );
  if (garIds.size === 0) return [];
  const { data } = await s
    .from("items")
    .select("id, code, name, item_class_id, is_active")
    .order("name");
  return ((data ?? []) as (PickerRow & { item_class_id: string | null })[]).filter(
    (i) => i.item_class_id && garIds.has(i.item_class_id),
  );
}

/**
 * Approved samples for the "Approved Sample No" cell (0461).
 *
 * THE LIST IS EMPTY IN THIS DATABASE — `samples` has no rows with
 * `status = 'approved'`, and that is why the field is OPTIONAL on both screens.
 * The Style master made its copy optional on 2026-08-13 for exactly this
 * reason: a required field with an empty picker is a record that cannot be
 * saved and nothing on screen to fix it with.
 *
 * `customer_id` RIDES ALONG AND IS NOT FILTERED IN SQL. 0422 gave `samples` a
 * customer so the field can narrow to the order's own; the narrowing happens on
 * the SCREEN, keyed on a Customer the operator is still choosing. Filtering here
 * would fix the list to whichever customer was selected when the page was
 * fetched — the same "narrow at the layer that knows the parent" call the
 * cascading-picker rule makes everywhere else.
 *
 * Deliberately a LOCAL copy of the Style master's `getApprovedSampleRows`
 * rather than an import: that module is `server-only` and its export would drag
 * the whole style service into this bundle for one twelve-line query. The label
 * shape is kept identical on purpose — two screens showing one sample list
 * should read the same.
 */
async function getApprovedSampleRows(): Promise<SamplePickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("samples")
    .select("id, code, type, created_at, customer_id")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return ((data ?? []) as {
    id: string;
    code: string | null;
    type: string;
    created_at: string;
    customer_id: string | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code ?? r.type,
    name: `${r.code ?? r.type} — ${r.type}, ${r.created_at.slice(0, 10)}`,
    customer_id: r.customer_id,
  }));
}

/**
 * The `components` master — it spells its label `short_name` and its flag
 * `inactive`.
 *
 * IT CARRIES ITS COORDINATE SCOPE TOO (0457), and that is the DATA HALF of the
 * cascading-picker rule rather than decoration. Order Info ▸ Styles Details ▸
 * Components has a Coordinate cell beside a Component cell, and narrowing the
 * second by the first is `componentsForCoordinate` — which cannot answer
 * without `all_coordinates` and the declared coordinate names. Selecting
 * `id, short_name, inactive` and calling the helper anyway is exactly the shape
 * AGENTS.md records twice: the rule appears wired, the column half passes, and
 * the narrowing silently never happens (`getItemReportFilterOptions` selecting
 * `id, name`; the `created_by` sweep).
 *
 * It narrows nothing TODAY — every component in the live master has
 * `all_coordinates = true` — and that is the design, not a gap. It starts
 * working the moment an operator unticks that box and lists a component's
 * sections, with no screen edit.
 *
 * The return is still assignable to `PickerRow`, so the Combos overlay's
 * `scopedComponents` and every other existing reader is untouched.
 */
async function getComponentPickerRows(): Promise<(PickerRow & ComponentScopeRow)[]> {
  const s = await createClient();
  const { data } = await s
    .from("components")
    .select("id, short_name, inactive, all_coordinates, coordinates:component_coordinates(coordinate)")
    .order("short_name");
  return ((data ?? []) as {
    id: string;
    short_name: string | null;
    inactive: boolean | null;
    all_coordinates: boolean | null;
    coordinates: { coordinate: string | null }[] | null;
  }[]).map((c) => ({
    id: c.id,
    code: null,
    name: c.short_name ?? "(unnamed)",
    inactive: c.inactive ?? false,
    // `all_coordinates` is NOT NULL with default true in 0228, so the coalesce
    // is for the shape PostgREST hands back, not for a row that could be null.
    // Defaulting the OTHER way would hide every component behind an empty
    // coordinate list — see `componentAllowsCoordinate`'s third case.
    all_coordinates: c.all_coordinates ?? true,
    coordinate_names: (c.coordinates ?? [])
      .map((x) => x.coordinate ?? "")
      .filter(Boolean),
  }));
}

/**
 * THE FABRICS BEHIND A STRUCTURE — `items` of class FABRIC.
 *
 * NOT AN OPTION LIST ANY MORE (0434). Nothing on this screen picks a fabric;
 * the Composition cell reads the `compositions` master again. What this feeds
 * is the DERIVATION: `compositionForStructure()` uses `category_id` to find a
 * structure's sole fabric and `mixing` to read its blend, and that is how 0430's
 * "fetch it from the previous tab automatically" survives the source changing.
 *
 * WHY THE MASTER CAME BACK, since this header used to argue the opposite. 0430
 * made two charges and both have been answered:
 *
 *   1. "there is nothing upstream to fetch it FROM" — because what the order
 *      knows is the Structure (a fabric category) and a category declares no
 *      composition. True, and answered not by ignoring it but by going one hop
 *      further: a Fabric MUST declare `material_mixings` ("A Fabric is DEFINED
 *      by what it is made of"), each mixing line names a yarn, and every yarn
 *      carries a CATEGORY — which is the unit `composition_lines` stores. So
 *      the blend reduces to the master's own vocabulary and the fetch is real.
 *   2. "that master's picker was empty anyway" — `select(... "blocked" ...)` on
 *      a table whose flag column is spelled `inactive` (0299 renamed it).
 *      PostgREST fails the WHOLE query on an unknown column, the
 *      `const { data } =` swallowed the error, and `data ?? []` turned it into
 *      "No composition found." That was a BUG, not a property of the master,
 *      and it is fixed (composition-actions.ts, composition-service.ts).
 *
 * The third thing that changed is the master itself: its `name` is now composed
 * from its own Mixing grid, so a row reads `COTTON 95%, ELASTANE 5%` instead of
 * the opaque `Test Composition` that made 0408's picker look unwired.
 *
 * THIS ONE STILL THROWS, for the reason charge 2 records: the same defect here
 * would say so instead of silently emptying the field. That is the shape
 * `getStyleRows` below carries an `if (error) throw` to prevent.
 *
 * THE LABEL IS STILL THE MIXTURE, and it is still read by a human — the folded
 * row summary and any future fabric picker. Note it renders the same idea in a
 * DIFFERENT format from the master (`95% COTTON / 5% ELASTANE` here,
 * `COTTON 95%, ELASTANE 5%` via `mixingList`). Unifying them is worth doing and
 * is deliberately not bundled here, because it would also change the Fabric
 * label on Fabric BOM. **The match never reads either string** — ids and
 * numbers only, so the two formats cannot make it wrong.
 *
 * THE LABEL IS THE MIXTURE, NOT THE MATERIAL'S NAME (operator, 2026-08-12, and
 * unchanged by the source moving). The legacy cell reads "100% BCI CO…" — the
 * composition SPELLED OUT, the only form the trade recognises. So the option name
 * is composed from the blend: `<pct>% <yarn>`, joined " / ", in `sno` order
 * because that order IS the recipe (the major yarn is stated first). Percentages
 * are trimmed of trailing zeros — the column is `numeric` and "100.00% COTTON" is
 * not how it is written — and a blend that names no percentage at all (13 of the
 * 17 mixing rows today) renders as the yarns alone rather than as "0% …", which
 * would be a figure the master never stated.
 *
 * A FABRIC WITH NO MIXING FALLS BACK TO ITS OWN NAME rather than rendering blank:
 * a row that exists must stay pickable, and a half-entered master is the
 * operator's to finish, not this function's to hide. The name is no loss here —
 * `SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%` is the
 * composition, spelled by the Material master's own auto-namer.
 *
 * `category_id` RIDES ALONG so the screen can scope the list to the picked
 * Structure — the cascading-picker rule, whose narrowing belongs at the caller
 * that knows the parent. `is_active` rides along unfiltered for the "Disabled
 * rows" rule: a switched-off fabric vanishes from the list while still resolving
 * on an order that already named it.
 */
async function getFabricRows(): Promise<FabricRow[]> {
  const s = await createClient();
  const { data: classes } = await s
    .from("config_lookups")
    .select("id, code")
    .eq("kind", "item_class");
  const fabricIds = new Set(
    ((classes ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "FABRIC")
      .map((c) => c.id),
  );
  if (fabricIds.size === 0) return [];
  const { data, error } = await s
    .from("items")
    .select(
      "id, code, name, item_class_id, category_id, is_active, " +
        // BOTH EMBEDS NAME THEIR CONSTRAINT, and neither is optional:
        // `material_mixings` holds TWO FKs to `items` — `item_id`, the fabric
        // that owns the row, and `component_item_id`, the yarn in it — so an
        // unqualified embed either way is AMBIGUOUS, and an ambiguous embed fails
        // the WHOLE query. That is the same failure mode that left this field
        // empty in the first place (see above), so it is spelled out rather than
        // trusted: both names verified against pg_constraint, not guessed.
        "mixings:material_mixings!material_mixings_item_id_fkey(" +
        "sno, blend_pct, description, " +
        "yarn:items!material_mixings_component_item_id_fkey(name, category_id))",
    )
    .order("name");
  if (error) throw new Error(`Could not load fabrics for the Structure picker: ${error.message}`);
  const pct = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
  return (
    (data ?? []) as unknown as {
      id: string;
      code: string | null;
      name: string | null;
      item_class_id: string | null;
      category_id: string | null;
      is_active: boolean | null;
      mixings:
        | {
            sno: number;
            blend_pct: number | null;
            description: string | null;
            yarn: { name: string | null; category_id: string | null } | null;
          }[]
        | null;
    }[]
  )
    .filter((i) => i.item_class_id && fabricIds.has(i.item_class_id))
    .map((i) => {
      const mixture = [...(i.mixings ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((m) => ({
          fibre: (m.yarn?.name ?? m.description ?? "").trim(),
          pct: m.blend_pct,
        }))
        .filter((m) => m.fibre)
        .map((m) => (m.pct == null ? m.fibre : `${pct(Number(m.pct))}% ${m.fibre}`))
        .join(" / ");
      // The same lines the label is built from, in the shape the RULE reads:
      // the yarn's CATEGORY, not its name. A composition speaks in categories
      // (COTTON) and a fabric's mixing in yarn items (30'S COTTON COMBED), so
      // the two are comparable only after this hop — which is also why the
      // match is on ids and never on the label above.
      const mixing: MixingShare[] = [...(i.mixings ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((m) => ({
          category_id: m.yarn?.category_id ?? null,
          pct: m.blend_pct == null ? null : Number(m.blend_pct),
        }));
      return {
        id: i.id,
        code: i.code,
        name: mixture || i.name || "(unnamed fabric)",
        category_id: i.category_id,
        is_active: i.is_active,
        mixing,
      };
    });
}

/** Every picker option list the amendment editor needs, fetched in parallel. */
/**
 * The Process master, for Style(s) ▸ Process (0411).
 *
 * BOTH applicability flags come down unfiltered, and that is the point. The
 * screen's Type field switches between `for_garments` and `for_components`
 * without a round trip, so filtering either one here would mean a fetch per
 * Type — and would leave the OTHER Type's saved rows unresolvable, showing a
 * filled field as empty.
 *
 * `inactive` is SELECTED and not filtered in SQL, the standing "Disabled rows"
 * rule: a switched-off process must vanish from the list while still resolving
 * on the order that already named it. `processesForKind` re-admits the held
 * value; this function must not pre-empt it.
 */
async function getProcessRows(): Promise<ProcessOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, inactive, for_garments, for_components")
    .order("name");
  return ((data ?? []) as {
    id: string; name: string; inactive: boolean | null;
    for_garments: boolean | null; for_components: boolean | null;
  }[]).map((p) => ({
    id: p.id,
    code: null,
    name: p.name,
    inactive: p.inactive ?? false,
    for_garments: p.for_garments ?? false,
    for_components: p.for_components ?? false,
  }));
}

/**
 * The Garment Rejection Rules, WITH their tiers, for Approval Qty's Projection
 * (0413).
 *
 * The tiers ride along with the options rather than being fetched when a rule is
 * picked, because the whole Approval Qty grid recalculates as the operator types
 * a quantity — a round trip per keystroke is not an option, and `rejectionFor`
 * is a pure function that only needs the bands.
 *
 * `blocked` is the disable flag on THIS master (not `inactive`, not
 * `is_active` — 0264 predates the 0299 rename), and it is SELECTED rather than
 * filtered in SQL: a rule switched off after an order named it must still
 * resolve, or the order's Projection would silently change. `isInactive()` reads
 * all three spellings, which is why the picker gets the raw flag.
 *
 * Rules are VERSIONED by `effective_from` — a revision is a new row, which is
 * why this master is exempt from the duplicate-name guard. The date rides along
 * so the picker can tell two same-named revisions apart.
 */
async function getRejectionRuleRows(): Promise<RejectionRuleOption[]> {
  const s = await createClient();
  /**
   * `inactive`, NOT `blocked` — THE COLUMN NAME, NOT THE OPTION'S FIELD NAME
   * (client 2026-08-27: rules made in the master did not appear on Order Entry).
   *
   * 0264 spells this table's disable flag `inactive`. The select asked for
   * `blocked`, and PostgREST rejects the WHOLE query for one unknown column —
   * so `data` came back null, `data ?? []` made that an empty list, and the
   * Rejection Rule picker was empty on every order while the master listed the
   * rule correctly beside it. Nothing looked broken: an empty dropdown reads as
   * "no rules have been set up yet", which is a real and unremarkable answer.
   *
   * The two names are NOT a rename. `RejectionRuleOption.blocked` stays as it
   * is: `isInactive()` reads all three spellings the schema uses, so the option
   * shape is deliberately in that vocabulary. Only the wire name was wrong.
   *
   * AGENTS.md says to read the flag through `isInactive()` rather than by hand,
   * and this is the failure it describes arriving one step earlier — not a flag
   * read wrongly, a flag ASKED FOR wrongly.
   */
  const { data, error } = await s
    .from("garment_rejection_rules")
    .select(
      "id, rule, inactive, effective_from, " +
        "lines:garment_rejection_rule_lines(from_value, to_value, rejection_allowance, allowance_type)",
    )
    .order("effective_from", { ascending: false });
  /**
   * THROW RATHER THAN HAND BACK AN EMPTY LIST.
   *
   * This is the actual lesson of the bug above, and it is worth more than the
   * one-word fix. `const { data } = await ...` cannot tell "no rules exist" from
   * "the query was rejected", and the two look identical on screen — one is an
   * empty master, the other is a broken one. A schema mismatch stayed invisible
   * until somebody noticed a dropdown that should not have been empty.
   *
   * `getAmendments` above already throws on its own error and that is how the
   * pack-composition table being missing was found in minutes rather than weeks.
   */
  if (error) {
    throw new Error(`Could not load rejection rules: ${error.message}`);
  }
  return ((data ?? []) as unknown as {
    id: string; rule: string | null; inactive: boolean | null; effective_from: string | null;
    lines: RejectionTier[] | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.effective_from,
    name: r.rule ?? "(unnamed rule)",
    blocked: isInactive(r),
    tiers: r.lines ?? [],
  }));
}

export async function getAmendmentFormData(): Promise<AmendmentFormData> {
  const [
    orders,
    customers,
    merchandisers,
    contacts,
    countries,
    currencies,
    lookups,
    paymentTermRows,
    styles,
    uoms,
    locations,
    consignees,
    warehouses,
    ports,
    categories,
    fabrics,
    compositions,
    samples,
    coordinates,
    componentRows,
    processes,
    rejectionRules,
  ] = await Promise.all([
    getOrderRows(),
    getCustomerRows(),
    getMerchandiserRows(),
    getContactRows(),
    listCountries(),
    listCurrencies(),
    listConfigLookups(),
    listPaymentTerms(),
    getStyleRows(),
    getUomRows(),
    getLocationRows(),
    getConsigneeRows(),
    getWarehouseRows(),
    getPortRows(),
    listCategories(),
    getFabricRows(),
    listCompositionsForPicker(),
    getApprovedSampleRows(),
    getCoordinateRows(),
    getComponentPickerRows(),
    getProcessRows(),
    getRejectionRuleRows(),
  ]);
  return {
    orders,
    customers,
    merchandisers,
    contacts,
    countries,
    currencies,
    lookups,
    paymentTerms: paymentTermsAsLookups(paymentTermRows),
    paymentTermDays: Object.fromEntries(
      paymentTermRows.map((t) => [t.id, t.credit_days ?? 0]),
    ),
    styles,
    uoms,
    locations,
    consignees,
    warehouses,
    ports,
    categories,
    fabrics,
    compositions,
    samples,
    coordinates,
    componentRows,
    processes,
    rejectionRules,
  };
}
