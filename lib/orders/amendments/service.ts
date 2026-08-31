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
/* A VALUE import, and the only one this file takes from `./types` — see
   `caseFoldKey` there for why the case fold is declared in a client-safe module
   rather than here: the service stamps the key and the SCREEN collapses on it,
   and a screen cannot import a `server-only` module. */
import { caseFoldKey } from "./types";
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
 * A T&A activity, as the ladder's Activity picker and Dept column need it
 * (0481) — the `ta_activities` master (0035 · 0266).
 *
 * A `PickerRow` with four extra fields rather than a reshaped one, the same
 * additive shape `ConsigneeRow` above uses and for the same reason: it is handed
 * straight to `RecordPicker`, and the rules that read the extra keys live on the
 * SCREEN, which is where the ladder is.
 *
 * `code` IS THE SHORT NAME. `ta_activities` has no `code` column — legacy's
 * "Short Name" is the identifier an operator types (0266), so it fills the slot
 * the picker searches and displays as a code. `short_name` is carried under its
 * own name as well, because the screen's `taLabel` falls back to it when an
 * activity has no `name` and mapping only into `code` would make that fallback
 * read a field that means something else.
 *
 * `department` RIDES ALONG AND IS NEVER COPIED ONTO THE ORDER'S ROW. It belongs
 * to the activity, so a copy stored on the order goes stale the day somebody
 * moves Knitting from one department to another — and the order would then
 * schedule work for a department that no longer does it. The Dept column reads
 * THROUGH this, which is the same call `AmendmentTaActivity` records.
 *
 * `sequence` is the axis the ladder is built on: `orderTaLadder` reverses on the
 * way in and back on the way out, so a row seeded out of order produces a
 * complete, plausible ladder of dates that are simply wrong.
 */
export type TaActivityOption = PickerRow & {
  short_name: string | null;
  department: string | null;
  sequence: number | null;
  /** The master's planned offset. Seeds "Days" when positive; see the screen. */
  default_offset_days: number;
};

/**
 * A customer, plus the key its case-duplicates fold onto (client 2026-08-31:
 * "ROJA" and "roja" must be one entry in the dropdown).
 *
 * The same shape of extension as `ConsigneeRow` above and for the same reason:
 * it is still handed straight to a picker, and the rule that READS the extra key
 * lives where the held value is — on the screen. `collapseCaseDuplicates` in
 * `./types` is that rule, written once so the picker and anything else that
 * needs it cannot disagree.
 *
 * THE SERVICE DELIBERATELY DOES NOT COLLAPSE. These are distinct `customers`
 * rows with distinct uuids, so folding them here means one uuid wins and an
 * order holding the loser resolves to nothing — the field renders empty and the
 * next save blanks the FK, which is the silent data loss "Disabled rows" exists
 * to prevent. Only the caller knows which uuid the record already holds, so
 * only the caller can guarantee it survives.
 */
export type CustomerRow = PickerRow & { dedupe_key: string };

/**
 * A merchandiser — a row of the HR EMPLOYEE master (0478), not a login.
 *
 * `is_merchandiser` is the client's narrowing (Designation *or* Department is
 * "Merchandiser") carried as a FLAG rather than applied as a filter, exactly as
 * `inactive` is on every other list here. Same reason, and it is not a
 * preference: `getAmendmentFormData()` takes no arguments — it is one options
 * bundle for the list screen and the editor — so this function cannot know
 * which employee the order being opened already names. Filter in SQL and an
 * order whose merchandiser has since moved department renders an empty field,
 * and the next save blanks the FK.
 *
 * The picker narrows to `is_merchandiser`, keeps the held row whatever it says,
 * and hides `inactive` the way it always did.
 */
export type MerchandiserRow = PickerRow & { is_merchandiser: boolean };

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
        // The order's Time & Action ladder (0481). `*` on purpose: the screen
        // needs `row_uid` to round-trip the anchor — without it every save
        // re-mints the row and loses the completion it carried — and the three
        // dashboard-owned columns (`actual_date`, `status`, `notes`) are
        // read-only here but must be SHOWN, since the tab is where an operator
        // sees how far the order has actually got.
        "ta_activities:garment_order_amendment_ta_activities(*), " +
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
    /* EXECUTION ORDER, and `sno` is the only thing that states it. The ladder
       is Fabric Plan → … → Shipment; `target_date` runs the other way and would
       sort a refused (undated) row to the front, so sorting on the date would
       be a second, disagreeing answer to "what order is this ladder in?". */
    ta_activities: bySno(r.ta_activities),
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
 *
 * ## `dedupe_key` — THE CASE-DUPLICATE FOLD (client 2026-08-31)
 *
 * "ROJA" and "roja" are two rows of this master and one customer. The key is
 * the folded name; the COLLAPSE happens on the screen, because only the screen
 * knows which of the pair the order in front of the operator already holds —
 * see `CustomerRow` above, and `collapseCaseDuplicates` in `./types`, which is
 * the single definition of both halves.
 *
 * This is a LEGACY row problem and saying so is the point. Since 2026-08-18
 * every `<Input>` in this app capitalises as you type and the write-side
 * transform lives in the Zod schema, so a case-differing pair cannot be created
 * by typing any more — it can only have been created before that date, or by an
 * import that predates it. That is why this is a fold over what is already
 * stored rather than a validation rule refusing new ones: a rule would guard a
 * door that is already shut, and would do nothing about the rows behind it.
 *
 * The fold HIDES a real master row, which is a thing worth telling somebody
 * about rather than doing quietly — `collapseCaseDuplicates` returns the names
 * it folded so the screen can say so and the operator can merge the masters.
 */
async function getCustomerRows(): Promise<CustomerRow[]> {
  const s = await createClient();
  /**
   * THROW RATHER THAN HAND BACK AN EMPTY LIST — `getRejectionRuleRows()` below
   * carries the full reasoning, and this is a Customer picker on the screen's
   * mandatory first field: empty reads as "no customers have been set up yet",
   * which is a real and unremarkable answer, so nobody reports it.
   */
  const { data, error } = await s
    .from("customers")
    .select("id, code, name, inactive")
    .order("name");
  if (error) {
    throw new Error(`Could not load customers: ${error.message}`);
  }
  return ((data ?? []) as PickerRow[]).map((r) => ({
    ...r,
    dedupe_key: caseFoldKey(r.name),
  }));
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

/**
 * The Merchandiser picker — THE HR EMPLOYEE MASTER, not the login accounts
 * (client 2026-08-31, and 0478 repoints the FK to match).
 *
 * It used to read `profiles`, which is whoever can sign in: neither every
 * merchandiser (one who does not use the system has no row) nor only
 * merchandisers (every storekeeper has one). `profiles` also carries no
 * designation and no department, so the client's narrowing could not be stated
 * against it at all. `employees` (0243) is the only one of the three candidate
 * tables with BOTH `designation_id` and `department_id`; `staff` (0013) has a
 * free-text designation and no department.
 *
 * ## `inactive`, NOT `blocked` — THE COLUMN NAME, NOT THE FIELD NAME
 *
 * 0243 created this table with `blocked` and **0299 renamed it to `inactive`**
 * along with 42 other masters. Selecting `blocked` would be the exact failure
 * `getRejectionRuleRows()` below records: PostgREST rejects the WHOLE query for
 * one unknown column, and an empty Merchandiser dropdown reads as "nobody has
 * been set up yet". Read from the catalog, never from memory — `isInactive()`'s
 * own header carries the query for it.
 *
 * It is SELECTED and not filtered in SQL, for the standing reason: an employee
 * an order already names must still resolve or the next save blanks the FK.
 *
 * ## THE NARROWING IS A FLAG, NOT A `WHERE`
 *
 * Same reasoning one step further out, and `MerchandiserRow` above states it:
 * `getAmendmentFormData()` takes no arguments, so this function cannot know
 * which employee the record being opened holds. Narrowing here would drop that
 * employee the day their designation changed, and the field would render empty
 * on an order that names them perfectly well.
 *
 * The COST is that every employee crosses the wire. Six small columns per row,
 * and this list is staff rather than the shop floor (`workers` is its own
 * table), so it is the cheaper of the two mistakes. Should it ever stop being
 * so, the fix is to give this function the held id — not to add a `WHERE`.
 *
 * ## MATCHING THE NAME
 *
 * "Merchandiser" is matched case- and whitespace-insensitively against the
 * `config_lookups` rows the two FKs point at, in TypeScript rather than in the
 * query, because `.ilike()` matches neither a stray trailing space nor the
 * lookups whose name the operator typed as "MERCHANDISER".
 *
 * The lookup query is NOT constrained by `kind`. Both columns are FKs to
 * `config_lookups` and each already says which question it answers, so adding
 * `kind in ('designation','department')` could only ever DROP a match — a
 * designation stored under a differently-spelled kind would silently stop
 * counting, and the symptom would again be a dropdown that is merely short.
 */
async function getMerchandiserRows(): Promise<MerchandiserRow[]> {
  const s = await createClient();

  const { data: lookupData, error: lookupErr } = await s
    .from("config_lookups")
    .select("id, name");
  if (lookupErr) {
    throw new Error(
      `Could not load the designation/department list: ${lookupErr.message}`,
    );
  }
  const merchandiserLookupIds = new Set(
    ((lookupData ?? []) as { id: string; name: string | null }[])
      .filter((l) => (l.name ?? "").trim().toLowerCase() === "merchandiser")
      .map((l) => l.id),
  );

  const { data, error } = await s
    .from("employees")
    .select("id, code, name, inactive, designation_id, department_id")
    .order("name");
  /**
   * THROW RATHER THAN HAND BACK AN EMPTY LIST. `getRejectionRuleRows()` below
   * carries the full argument; this is the field it now matters most on,
   * because Merchandiser became mandatory in the same change — a silently
   * broken query would leave the operator unable to save an order at all, with
   * nothing on screen saying why.
   */
  if (error) {
    throw new Error(`Could not load merchandisers: ${error.message}`);
  }

  return ((data ?? []) as {
    id: string;
    code: string | null;
    name: string | null;
    inactive: boolean | null;
    designation_id: string | null;
    department_id: string | null;
  }[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name ?? "(unnamed)",
    inactive: r.inactive ?? false,
    is_merchandiser:
      (!!r.designation_id && merchandiserLookupIds.has(r.designation_id)) ||
      (!!r.department_id && merchandiserLookupIds.has(r.department_id)),
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
  /* Carries `dedupe_key`; the picker collapses on it, keeping the held row.
     See `CustomerRow` — the fold cannot happen here. */
  customers: CustomerRow[];
  /* Carries `is_merchandiser`; the picker narrows on it, keeping the held row.
     See `MerchandiserRow` — the narrowing cannot happen in SQL. */
  merchandisers: MerchandiserRow[];
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
  /**
   * T&A (0481) — the `ta_activities` master the ladder is seeded and labelled
   * from. Carries `sequence`, `department` and `default_offset_days`; see
   * `TaActivityOption`.
   */
  taActivities: TaActivityOption[];
};

/**
 * The T&A activity master, for the ladder's Activity picker (0481).
 *
 * ORDERED BY `sequence`, which is not decoration: it is the axis the ladder is
 * built on, and a screen that seeded its rows in insertion order would produce a
 * complete, plausible plan whose every date is wrong. Ordered here as well as
 * sorted on the screen, so the list is right whichever consumer reads it.
 *
 * `is_active` IS SELECTED AND NOT FILTERED IN SQL — the "Disabled rows" rule.
 * Filtering here satisfies half of it and breaks the other half: an activity
 * retired from the master after an order was written would resolve to nothing,
 * the Activity cell would render empty on a ladder that names it perfectly well,
 * and the next save would blank the FK. `RecordPicker` hides it from the list
 * and keeps the held row; `seedTaLadder` skips it when building a fresh ladder.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. An empty activity master gives
 * a T&A tab with nothing to pick, which reads exactly like "nobody has set the
 * activities up yet" — a real and unremarkable answer, and so one that gets
 * believed rather than reported.
 */
async function getTaActivityRows(): Promise<TaActivityOption[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("ta_activities")
    .select("id, short_name, name, department, sequence, default_offset_days, is_active")
    .order("sequence");
  if (error) throw new Error(`Could not load the T&A activity master: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    short_name: string | null;
    name: string | null;
    department: string | null;
    sequence: number | null;
    default_offset_days: number | null;
    is_active: boolean | null;
  }[]).map((r) => ({
    id: r.id,
    // See `TaActivityOption`: legacy's Short Name is what an operator types.
    code: r.short_name,
    name: r.name ?? r.short_name ?? "",
    short_name: r.short_name,
    department: r.department,
    sequence: r.sequence,
    /* `?? 0` and not `?? null`: the column is `not null default 0`, and the
       screen reads `> 0` to decide whether to prefill Days. A null would make
       that comparison false anyway, but stating the column's own default here
       keeps the two ends saying the same thing. */
    default_offset_days: r.default_offset_days ?? 0,
    is_active: r.is_active,
  }));
}

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
    customers,
    merchandisers,
    countries,
    currencies,
    lookups,
    paymentTermRows,
    styles,
    uoms,
    locations,
    consignees,
    categories,
    fabrics,
    compositions,
    samples,
    coordinates,
    componentRows,
    processes,
    rejectionRules,
    taActivities,
  ] = await Promise.all([
    getCustomerRows(),
    getMerchandiserRows(),
    listCountries(),
    listCurrencies(),
    listConfigLookups(),
    listPaymentTerms(),
    getStyleRows(),
    getUomRows(),
    getLocationRows(),
    getConsigneeRows(),
    listCategories(),
    getFabricRows(),
    listCompositionsForPicker(),
    getApprovedSampleRows(),
    getCoordinateRows(),
    getComponentPickerRows(),
    getProcessRows(),
    getRejectionRuleRows(),
    getTaActivityRows(),
  ]);
  return {
    /**
     * NOT FETCHED ANY MORE (2026-08-31). `getOrderRows()` selected EVERY
     * `sales_orders` row with a `buyers` embed and no limit — 93 today, growing
     * with the order book — to fill the SCNo dropdown, which this screen
     * documents as UNREACHABLE SINCE 2026-08-11.
     *
     * The key stays and answers `[]` rather than being deleted: the screen's
     * `orderItems` / `onSelectOrder` machinery is deliberately KEPT pending a
     * decision on where amendments live, and its own note says not to silence
     * the unused-variable warnings. An empty list is what an unreachable picker
     * already showed, so nothing an operator can see changes. Restore
     * `getOrderRows()` here in the same change that gives that picker a door.
     */
    orders: [],
    customers,
    merchandisers,
    /* NOT FETCHED (2026-08-31) — nothing in the repo reads `data.contacts`.
       The Logistic "Contact" picker it was written for does not exist. */
    contacts: [],
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
    /* NOT FETCHED (2026-08-31) — zero references anywhere in the repo. */
    warehouses: [],
    /* NOT FETCHED (2026-08-31) — zero references anywhere in the repo. */
    ports: [],
    categories,
    fabrics,
    compositions,
    samples,
    coordinates,
    componentRows,
    processes,
    rejectionRules,
    taActivities,
  };
}
