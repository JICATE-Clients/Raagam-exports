import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import { listCurrencies } from "@/lib/masters/service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listPaymentTerms } from "@/lib/masters/payment-term-service";
import { paymentTermsAsLookups } from "@/lib/masters/lookup-compat";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
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
        "buyer:buyers(id,code,name), " +
        "charges:garment_order_amendment_charges(*), " +
        "style_prices:garment_order_amendment_style_prices(*), " +
        "styles:garment_order_amendment_styles(*), " +
        "dyeings:garment_order_amendment_dyeings(*), " +
        "prints:garment_order_amendment_prints(*), " +
        "structures:garment_order_amendment_structures(*), " +
        "combos:garment_order_amendment_combos(*), " +
        "price_details:garment_order_amendment_price_details(*), " +
        "approval_qtys:garment_order_amendment_approval_qtys(*), " +
        "pack_types:garment_order_amendment_pack_types(*), " +
        "quantities:garment_order_amendment_quantities(*), " +
        "country_sizes:garment_order_amendment_country_sizes(*)",
    )
    .order("created_at", { ascending: false });

  /**
   * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — the same rule `getStyleRows`
   * below already carries, and this is the function it was missed on.
   *
   * THIRTEEN EMBEDS, so this is the query in the module most able to fail
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
    dyeings: bySno(r.dyeings),
    prints: bySno(r.prints),
    structures: bySno(r.structures),
    combos: bySno(r.combos),
    price_details: bySno(r.price_details),
    approval_qtys: bySno(r.approval_qtys),
    pack_types: bySno(r.pack_types),
    quantities: bySno(r.quantities),
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

/** Buyers for the "Customer" picker (the order's party). */
async function getBuyerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("buyers")
    .select("id, code, name, is_active")
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
async function getConsigneeRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("consignees")
    .select("id, code, name, inactive")
    .order("name");
  return (data ?? []) as PickerRow[];
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
  /** The style's own UoM (`garment_styles.unit_id` -> `uoms`). Seeds BOTH the
   *  Order Unit and the Plan Unit on the order line, which is what "these units
   *  pull from the General tab of the Style Entry" means (client 2026-08-10). */
  unit_id: string | null;
  /** Free-text remarks from Style Entry; seeds the line's Description. */
  description: string | null;
  /** `garment_styles` spells its disable flag `blocked` (0124). */
  blocked: boolean;
};

/**
 * A colour for the Color/Print dyeing pickers. color_card_colors is the only
 * colour data in the app (there is no global colour master) — each colour belongs
 * to a colour card, which belongs to a buyer, so we carry buyer_id to scope the
 * picker to the amendment's buyer. See doc/masters-open-questions.md.
 */
export type DyeColorRow = {
  id: string;
  code: string | null;
  name: string;
  buyer_id: string | null;
  card_label: string | null;
};

/** Garment styles for the Style(s) tab picker (+ context for auto-fill). */
async function getStyleRows(): Promise<StylePickerRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_styles")
    .select(
      "id, code, style_name, article_no, style_description, description, unit_id, blocked, " +
        // `categories`, NOT `config_lookups`. 0394 repointed
        // `garment_styles.style_category_id` at the Garment master and left the
        // constraint NAME unchanged, so this embed kept naming a relationship
        // that no longer exists — PostgREST could not resolve it and failed the
        // WHOLE query. With the error swallowed below that surfaced as an empty
        // Style picker on the amendment screen: nothing to pick, no error, and
        // the Style(s) tab simply unusable.
        "category:categories!garment_styles_style_category_id_fkey(name)",
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
    unit_id: string | null;
    blocked: boolean;
    category?: { name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.style_name ?? "(unnamed style)",
    article_no: r.article_no,
    style_category: r.category?.name ?? null,
    style_description: r.style_description,
    unit_id: r.unit_id,
    description: r.description,
    blocked: r.blocked,
  }));
}

/** Units of measure for the Order Unit / Plan Unit pickers. */
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

/** Colour-card colours for the dyeing pickers (+ buyer scope + card label). */
async function getDyeColorRows(): Promise<DyeColorRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("color_card_colors")
    .select("id, name, code, card:color_cards(buyer_id, name, code)")
    .order("sort_order");
  // Same rule, same reason: the `card` embed is what the Color/Print tab reads to
  // scope colours to the order's buyer, and a silent [] would leave that tab
  // looking like the buyer simply has no colour card.
  if (error) throw new Error(`Could not load colours: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    name: string | null;
    code: string | null;
    card?: { buyer_id: string | null; name: string | null; code: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name ?? "(unnamed colour)",
    buyer_id: r.card?.buyer_id ?? null,
    card_label: r.card?.name ?? r.card?.code ?? null,
  }));
}

export type AmendmentFormData = {
  orders: OrderPickerRow[];
  buyers: PickerRow[];
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
  styles: StylePickerRow[];
  uoms: PickerRow[];
  /** Quantities grid (0398). */
  consignees: PickerRow[];
  warehouses: PickerRow[];
  ports: PickerRow[];
  dyeColors: DyeColorRow[];
  /**
   * The Unit the SC No is numbered under — 0395 counts per (location, fiscal
   * year). `is_active` is SELECTED and not filtered in SQL, so `RecordPicker`
   * can hide switched-off units while still resolving one an existing order
   * already holds ("Disabled rows": filtering in SQL satisfies half the rule
   * and breaks the other half).
   */
  locations: PickerRow[];
};

/** Every picker option list the amendment editor needs, fetched in parallel. */
export async function getAmendmentFormData(): Promise<AmendmentFormData> {
  const [
    orders,
    buyers,
    merchandisers,
    contacts,
    countries,
    currencies,
    lookups,
    paymentTermRows,
    styles,
    uoms,
    dyeColors,
    locations,
    consignees,
    warehouses,
    ports,
  ] = await Promise.all([
    getOrderRows(),
    getBuyerRows(),
    getMerchandiserRows(),
    getContactRows(),
    listCountries(),
    listCurrencies(),
    listConfigLookups(),
    listPaymentTerms(),
    getStyleRows(),
    getUomRows(),
    getDyeColorRows(),
    getLocationRows(),
    getConsigneeRows(),
    getWarehouseRows(),
    getPortRows(),
  ]);
  return {
    orders,
    buyers,
    merchandisers,
    contacts,
    countries,
    currencies,
    lookups,
    paymentTerms: paymentTermsAsLookups(paymentTermRows),
    styles,
    uoms,
    dyeColors,
    locations,
    consignees,
    warehouses,
    ports,
  };
}
