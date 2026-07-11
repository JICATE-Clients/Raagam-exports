import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import { listCurrencies } from "@/lib/masters/service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { GarmentOrderAmendment } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

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
  const { data } = await s
    .from("garment_order_amendments")
    .select(
      "*, sales_order:sales_orders(id,order_number), " +
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
        "country_sizes:garment_order_amendment_country_sizes(*)",
    )
    .order("created_at", { ascending: false });

  const bySno = <T extends { sno: number }>(rows: T[] | undefined): T[] =>
    [...(rows ?? [])].sort((a, b) => a.sno - b.sno);

  return ((data ?? []) as unknown as GarmentOrderAmendment[]).map((r) => ({
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
    country_sizes: bySno(r.country_sizes),
  }));
}

/** Confirmed sales orders for the SCNo picker (+ context for auto-load). */
async function getOrderRows(): Promise<OrderPickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number, buyer_id, currency_code, ship_date, buyers(name)")
    .order("created_at", { ascending: false });
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

/** Buyers for the "Customer" picker (the order's party). */
async function getBuyerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("buyers")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** App users for the "Merchand." picker. */
async function getMerchandiserRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("profiles")
    .select("id, employee_code, full_name")
    .eq("is_active", true)
    .order("full_name");
  return ((data ?? []) as { id: string; employee_code: string | null; full_name: string | null }[]).map(
    (r) => ({ id: r.id, code: r.employee_code, name: r.full_name ?? "(unnamed)" }),
  );
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
  const { data } = await s
    .from("garment_styles")
    .select(
      "id, code, style_name, article_no, style_description, " +
        "category:config_lookups!garment_styles_style_category_id_fkey(name)",
    )
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    style_name: string | null;
    article_no: string | null;
    style_description: string | null;
    category?: { name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.style_name ?? "(unnamed style)",
    article_no: r.article_no,
    style_category: r.category?.name ?? null,
    style_description: r.style_description,
  }));
}

/** Units of measure for the Order Unit / Plan Unit pickers. */
async function getUomRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** Colour-card colours for the dyeing pickers (+ buyer scope + card label). */
async function getDyeColorRows(): Promise<DyeColorRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("color_card_colors")
    .select("id, name, code, card:color_cards(buyer_id, name, code)")
    .order("sort_order");
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
  styles: StylePickerRow[];
  uoms: PickerRow[];
  dyeColors: DyeColorRow[];
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
    styles,
    uoms,
    dyeColors,
  ] = await Promise.all([
    getOrderRows(),
    getBuyerRows(),
    getMerchandiserRows(),
    getContactRows(),
    listCountries(),
    listCurrencies(),
    listConfigLookups(),
    getStyleRows(),
    getUomRows(),
    getDyeColorRows(),
  ]);
  return {
    orders,
    buyers,
    merchandisers,
    contacts,
    countries,
    currencies,
    lookups,
    styles,
    uoms,
    dyeColors,
  };
}
