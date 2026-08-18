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
import type { Deactivatable } from "@/lib/masters/inactive";
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
export type FabricRow = PickerRow & { category_id: string | null };

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
        // The Assort tree (0414). Two levels of embed under the quantity row —
        // and, like every other name here, ONE unresolvable relationship
        // fails the WHOLE query rather than this branch of it, which is why
        // this lands in the same edit as the migration.
        "quantities:garment_order_amendment_quantities(*, assort_lines:garment_order_amendment_assort_lines(*, sizes:garment_order_amendment_assort_line_sizes(*))), " +
        "country_sizes:garment_order_amendment_country_sizes(*)",
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
  components: {
    sno: number;
    coordinate_id: string | null;
    component_id: string | null;
    /** The component's Structure — a fabric CATEGORY (0405). */
    fabric_category_id: string | null;
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
        "components:garment_style_components(sno, coordinate_id, component_id, fabric_category_id)",
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
    category?: { name: string } | null;
    sizes?: { sno: number | null; size_id: string | null }[] | null;
    components?: {
      sno: number | null;
      coordinate_id: string | null;
      component_id: string | null;
      fabric_category_id: string | null;
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
    sizes: [...(r.sizes ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((x) => ({ sno: x.sno ?? 0, size_id: x.size_id })),
    components: [...(r.components ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((x) => ({
        sno: x.sno ?? 0,
        coordinate_id: x.coordinate_id,
        component_id: x.component_id,
        fabric_category_id: x.fabric_category_id,
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
   * THE FABRICS a combo structure may name, and their `name` IS THE COMPOSITION
   * (0430). Replaced `compositions`, which pointed this field at a master the
   * order could not fetch from — see `getFabricRows`.
   */
  fabrics: FabricRow[];
  /** A COORDINATE IS A GARMENT (0396) — `items` of class GAR. */
  coordinates: PickerRow[];
  /** The `components` master (0228/0396), not the empty lookup kind. */
  componentRows: PickerRow[];
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

/** The `components` master — it spells its label `short_name` and its flag `inactive`. */
async function getComponentPickerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("components")
    .select("id, short_name, inactive")
    .order("short_name");
  return ((data ?? []) as { id: string; short_name: string | null; inactive: boolean | null }[]).map(
    (c) => ({ id: c.id, code: null, name: c.short_name ?? "(unnamed)", inactive: c.inactive ?? false }),
  );
}

/**
 * THE FABRICS a combo structure can name — `items` of class FABRIC, LABELLED BY
 * THEIR COMPOSITION (client 2026-08-17, screenshot 2324).
 *
 * This replaced `getCompositionRows()`, and both halves of that replacement are
 * the point:
 *
 * WHY NOT THE `compositions` MASTER. 0408 pointed this field at it, so the value
 * could only ever be typed in by hand from a master with one test row in it —
 * there is nothing upstream to fetch it FROM, because what the order knows is
 * the Structure (a fabric category) and a category declares no composition. A
 * Fabric material does, and must: `material_mixings` is mandatory on the Material
 * master ("A Fabric is DEFINED by what it is made of"). So the row names the
 * fabric and the composition is derived from it (0430).
 *
 * AND WHY THAT MASTER'S PICKER WAS EMPTY ANYWAY — `select(... "blocked" ...)` on
 * a table whose flag column is spelled `inactive` (0299 renamed it). PostgREST
 * fails the WHOLE query on an unknown column, the `const { data } =` swallowed
 * the error, and `data ?? []` turned it into "No composition found." — a picker
 * that looked merely unpopulated, which is the exact shape `getStyleRows` below
 * carries an `if (error) throw` to prevent. THAT is why this one throws too: the
 * same defect here would now say so instead of emptying the field.
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
        "yarn:items!material_mixings_component_item_id_fkey(name))",
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
            yarn: { name: string | null } | null;
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
      return {
        id: i.id,
        code: i.code,
        name: mixture || i.name || "(unnamed fabric)",
        category_id: i.category_id,
        is_active: i.is_active,
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
  const { data } = await s
    .from("garment_rejection_rules")
    .select(
      "id, rule, blocked, effective_from, " +
        "lines:garment_rejection_rule_lines(from_value, to_value, rejection_allowance, allowance_type)",
    )
    .order("effective_from", { ascending: false });
  return ((data ?? []) as unknown as {
    id: string; rule: string | null; blocked: boolean | null; effective_from: string | null;
    lines: RejectionTier[] | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.effective_from,
    name: r.rule ?? "(unnamed rule)",
    blocked: r.blocked ?? false,
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
    coordinates,
    componentRows,
    processes,
    rejectionRules,
  };
}
