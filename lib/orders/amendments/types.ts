import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";
import { isUnitKind, type UnitKind } from "@/lib/orders/styles/rules";

// ============================================================================
// Garment Orders ▸ Garment Order Amendment. Header + 10 sub-tabs.
// 0126 built the header + Logistic (charges + style-price grids) + Reason.
// 0128 added the data tabs — Style(s), Color/Print (dyeings + prints +
// structures), Combos, Prices, Approval Qty, Country/Sizewise — and reworked
// Reason into the "Amendment In" checkbox panel. Pack type(s) + full Quantities
// remain deferred (no screenshot). Icon fields reference sales_orders / buyers /
// profiles / garment_styles / uoms / color_card_colors / countries / currencies /
// customer_contacts / config_lookups (kinds department, ship_type, agent,
// payment_term, structure, roll_form_print).
// ============================================================================

// Fixed dropdowns — legacy option lists (confirm exact values via screenshots).
// WITHDRAWN FROM THE FORM 2026-08-11 (client) and kept for the same reason
// RECEIPT_MODES is: `orders_amendments.initiated` and its stored rows are
// untouched, and this tuple is the only record of the vocabulary they hold.
export const INITIATED_OPTIONS = ["By Customer", "By Us"] as const;
// AMEND_TYPE_OPTIONS joined them 2026-08-11: the "Type" dropdown went, on the
// grounds that the company only makes garments, so Fabric and Made-ups were
// answers no order could have. `amend_type` still holds them on older rows.
export const AMEND_TYPE_OPTIONS = ["Garment", "Fabric", "Made-ups"] as const;

/**
 * ORDER UNIT IS PCS OR SET, AND IT IS THE STYLE'S OWN ANSWER (client
 * 2026-08-11: "Order Unit (PCS/SET) is sufficient").
 *
 * It was a `uoms` picker — nos / mtr / kg / gross / yard / set — seeded from
 * `garment_styles.unit_id`. The line now reads the style's `unit_kind`
 * ('piece' | 'set', 0392), which is the SAME value that caps that style's
 * Coordinates grid via `COORDINATE_LIMITS`.
 *
 * DERIVED, NOT COPIED, AND THAT IS THE POINT. A garment style either IS one
 * garment or IS a set of 2-6 coordinates, so an order line naming that style
 * has no room to disagree with it — there is nothing here for an operator to
 * choose. Resolving it through `style_id` on every read means the two can never
 * drift; a snapshot column would be a second source of truth for a fact the
 * style already owns. `style_id` is stored, so a reopened amendment re-derives
 * the same answer.
 *
 * `uoms` CANNOT CARRY THIS VALUE and must not be made to. It is seeded
 * lowercase, has NO piece row at all, and its codes are editable from the Stock
 * Unit master — inferring Piece/Set from it is exactly what the Style screen
 * rejected outright on 2026-08-11, and re-proposing it here would break the
 * rule silently the day someone tidies that master.
 *
 * THE WORDS ARE THE CLIENT'S: PCS and SET, not the Style screen's Piece / Set.
 * Capitals per AGENTS.md, and not merely cosmetic here — this string is STORED,
 * on `garment_order_amendment_price_details.unit`, whose Unit "is pulled from
 * the Order Unit established in the initial Style Entry".
 *
 * Keyed by `UnitKind` rather than written as a ternary so a third kind added to
 * `COORDINATE_LIMITS` fails to compile here instead of quietly reading blank.
 */
const ORDER_UNIT_LABELS: Record<UnitKind, string> = { piece: "PCS", set: "SET" };

/**
 * A style's Order Unit as the word the order shows and stores.
 *
 * BLANK IS A REAL ANSWER, NOT A DEFAULT. Every style created before 2026-08-10
 * has no `unit_kind` (0392 added it nullable), and guessing PCS for those would
 * put an invented unit against a real PO Qty. Same silence `coordinateLimit`
 * keeps, for the same reason.
 */
export function orderUnitLabel(unitKind: string | null | undefined): string {
  return isUnitKind(unitKind) ? ORDER_UNIT_LABELS[unitKind] : "";
}
/**
 * How a style's price is broken down (client 2026-08-10). "The most critical
 * field in this tab, as it determines how the pricing grid behaves":
 *
 *   Style-wise — one price for the style, whatever the colour or size.
 *   Color-wise — a price per colourway; a neon combo can cost more than a white.
 *   Size-wise  — a price per size; 2XL can cost more than S.
 *
 * Stored as text in `garment_order_amendment_price_details.price_type`, which is
 * why this is a plain tuple and not a config_lookups kind: three fixed modes the
 * business does not add to, like SHIP_MODES and PAY_MODES below.
 */
/**
 * How finished garments are sorted into cartons (client 2026-08-10). Four
 * standard industry methods, and the two axes are independent: colour solid or
 * assorted, size solid or assorted.
 *
 *   Solid Colour / Solid Size   one colour, one size per carton
 *   Solid Colour / Assort Size  one colour, mixed sizes
 *   Assort Colour / Solid Size  mixed colours, one size
 *   Assort Colour / Assort Size mixed colours AND mixed sizes
 *
 * ONE DECLARATION, because the list is named in two places: the Pack type(s) tab
 * defines it and the Quantities tab picks one per destination. Two hand-written
 * copies of a four-item list is how they start disagreeing about the wording,
 * and the wording is what the Packing List prints.
 *
 * STORED SINCE 0399, and the legacy screen answered the question this comment
 * used to leave open: the tab is a GRID, so an order declares the pack methods
 * it uses and may declare more than one. Not a header column, and not (yet) a
 * column on the quantities child.
 *
 * ALSO SEEDED AS DATA, ONCE (0400). The same four names are rows under
 * `config_lookups` kind `assortment_type`, which is what the Quantities tab's
 * Assortment Type picks from — so the two tabs ask the same question in the
 * same words. The tie is the WORDING and nothing enforces it: that kind is
 * operator-maintained through the picker's inline Add, deliberately, so
 * re-wording a method here means a NEW migration re-wording the row too
 * (editing 0400 changes nothing — it has already run). Nothing breaks if they
 * drift; the two tabs just stop reading alike.
 *
 * A ROW MAY HOLD A VALUE THAT IS NOT IN THIS TUPLE. `pack_type` is text with no
 * CHECK, so re-wording an option here does not invalidate what is already
 * saved — but a `<Select>` matches on VALUE, so a stale row would render blank
 * (the same trap RECEIPT_MODES records below). The screen keeps a held
 * off-tuple value on its own option list rather than silently dropping it.
 */
export const PACK_TYPE_OPTIONS = [
  "Solid Colour / Solid Size",
  "Solid Colour / Assort Size",
  "Assort Colour / Solid Size",
  "Assort Colour / Assort Size",
] as const;

export const PRICE_TYPE_OPTIONS = ["Style-wise", "Color-wise", "Size-wise"] as const;
export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;
// Reused from the Applicant/Customer masters (see doc/masters-open-questions.md).
export const SHIP_MODES = ["AIR", "ROAD", "SEA"] as const;
export const PAY_MODES = ["CAD", "CASH", "CHEQUE", "DA", "DD", "DP", "LC", "OTH"] as const;
// CAPS like SHIP_MODES and PAY_MODES above — it was the only Title Case set in
// this block, on the same form. `orders_amendments.received_mode` is free text
// (0126:49) so there is no CHECK to move, but migration 0368 DOES rewrite the
// stored rows: the Select matches on value, so a row still holding "By Mail"
// would render as blank against a "BY MAIL" option list.
export const RECEIPT_MODES = ["BY MAIL", "BY HAND", "COURIER", "EMAIL"] as const;
// Color/Print ▸ Dyeing sections (the Yarn / Fabric split).
export const DYE_SECTIONS = ["yarn", "fabric"] as const;

// ---- row interfaces (mirror DB columns) ----
export interface AmendmentCharge {
  id: string;
  amendment_id: string;
  sno: number;
  section: "less" | "add";
  label: string | null;
  calc_mode: string | null;
  amount: number;
  unit: string | null;
}

export interface AmendmentStylePrice {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  price: number;
  csp_type: string | null;
  csp_price: number;
  fob_buyer_price: number;
  fob_selling_price: number;
}

// ---- Phase 2 (0128) child rows, one per data tab ----

/** Style(s) tab — a styles-detail row. */
export interface AmendmentStyle {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style_id: string | null;
  article_no: string | null;
  style_category: string | null;
  style_description: string | null;
  order_unit_id: string | null;
  plan_unit_id: string | null;
  po_qty: number;
  description: string | null;
}

/** Color/Print tab — a Yarn or Fabric dyeing row. */
export interface AmendmentDyeing {
  id: string;
  amendment_id: string;
  sno: number;
  section: "yarn" | "fabric";
  dye_type: string | null;
  /**
   * The colour AS TYPED (0403). Colour Cards was withdrawn as a screen on
   * 2026-08-11 and it was the app's only colour data, so this cell is free text
   * like `dye_type` beside it rather than a dropdown over nothing.
   */
  color_name: string | null;
  /** Pre-0403 colour-card reference. Frozen, not dropped — see 0403's header. */
  color_id: string | null;
}

/** Color/Print tab — a roll-form print row. */
export interface AmendmentPrint {
  id: string;
  amendment_id: string;
  sno: number;
  print_id: string | null;
}

/** Color/Print tab — a structure row. */
export interface AmendmentStructure {
  id: string;
  amendment_id: string;
  sno: number;
  structure_id: string | null;
}

/** Combos tab — a combo row. */
export interface AmendmentCombo {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
}

/** Prices tab — a price-detail row (distinct from Logistic's style_prices). */
export interface AmendmentPriceDetail {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  price_type: string | null;
  unit: string | null;
  price: number;
}

/** Approval Qty tab — a style + approval quantity row. */
export interface AmendmentApprovalQty {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  approval_qty: number;
}

/**
 * Pack type(s) tab (0399) — one row per packing method the order uses.
 *
 * The whole row is its own value: there is nothing to say about a pack method
 * beyond naming it, which is why this is the only child with a single data
 * column. `pack_type` is one of `PACK_TYPE_OPTIONS`, stored as text.
 */
export interface AmendmentPackType {
  id: string;
  amendment_id: string;
  sno: number;
  pack_type: string | null;
}

/**
 * Quantities tab (0398) — how the order's quantity splits across countries,
 * consignees and delivery dates.
 *
 * `style_ref_no` + `style_no` are the Orders module key, carried as TEXT like
 * every sibling child table; see the migration header for why this is not a
 * `garment_styles` FK.
 */
export interface AmendmentQuantity {
  id: string;
  amendment_id: string;
  sno: number;
  country_id: string | null;
  style_ref_no: string | null;
  style_no: string | null;
  consignee_id: string | null;
  assortment_type_id: string | null;
  po_qty: number;
  delivery_date: string | null;
  earlier_shipment_date: string | null;
  warehouse_id: string | null;
  discharge_port_id: string | null;
}

/** Country/Sizewise tab — a style + countrywise flag row. */
export interface AmendmentCountrySize {
  id: string;
  amendment_id: string;
  sno: number;
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  countrywise: boolean;
}

export interface GarmentOrderAmendment {
  id: string;
  code: string | null;
  is_draft: boolean;
  // order header
  sales_order_id: string | null;
  amend_date: string;
  initiated: string | null;
  amend_type: string | null;
  /** The Customer master row this order is for (0404). Was `buyer_id`. */
  customer_id: string | null;
  po_no: string | null;
  po_date: string | null;
  merchandiser_id: string | null;
  season: string | null;
  amend_year: number | null;
  delivery_date: string | null;
  excess_pct: number;
  pack: boolean;
  mult_ord: boolean;
  // logistic scalars
  department_id: string | null;
  ship_type_id: string | null;
  contact_id: string | null;
  logi_po_date: string | null;
  agent_id: string | null;
  ship_mode: string | null;
  country_id: string | null;
  currency_code: string | null;
  received_date: string | null;
  received_mode: string | null;
  pay_mode: string | null;
  pay_terms_id: string | null;
  ex_rate: number;
  avg_rate: number;
  gross_value: number;
  // cash discount
  cd1_pct: number;
  cd1_days: number;
  cd2_pct: number;
  cd2_days: number;
  cd3_pct: number;
  cd3_days: number;
  // reason ("Amendment In" panel)
  amend_in_material_bom: boolean;
  amend_in_fabric_bom: boolean;
  amend_in_garment_process_bom: boolean;
  reason_text: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  sales_order?: { id: string; order_number: string | null; location_id: string | null } | null;
  customer?: { id: string; code: string | null; name: string } | null;
  charges: AmendmentCharge[];
  style_prices: AmendmentStylePrice[];
  styles: AmendmentStyle[];
  dyeings: AmendmentDyeing[];
  prints: AmendmentPrint[];
  structures: AmendmentStructure[];
  combos: AmendmentCombo[];
  price_details: AmendmentPriceDetail[];
  approval_qtys: AmendmentApprovalQty[];
  pack_types: AmendmentPackType[];
  quantities: AmendmentQuantity[];
  country_sizes: AmendmentCountrySize[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const num = z.coerce.number().default(0);

export const amendmentStylePriceInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  price: num,
  csp_type: nullableText,
  csp_price: num,
  fob_buyer_price: num,
  fob_selling_price: num,
});

// ---- Phase 2 (0128) nested grid inputs ----

export const amendmentStyleInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style_id: uuidN,
  article_no: nullableText,
  style_category: nullableText,
  style_description: nullableText,
  order_unit_id: uuidN,
  plan_unit_id: uuidN,
  po_qty: num,
  description: nullableText,
});

export const amendmentDyeingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  section: z.enum(["yarn", "fabric"]).default("yarn"),
  dye_type: nullableText,
  // CAPS (AGENTS.md, STANDING). The transform lives in the ZOD SCHEMA, not
  // in the action: `lib/data-io` parses imports with these same *Input
  // schemas and writes straight to Postgres, so an action-level
  // `.toUpperCase()` would silently miss every spreadsheet import. The
  // `<Input uppercase>` on the Colour cell is the other required half — it
  // catches the keystroke AND adds the CSS transform that reaches rows
  // saved before this rule.
  //
  // `dye_type` beside it is deliberately NOT capsed here: it is
  // pre-existing and unrequested, and capping it would visually uppercase
  // values already stored in lowercase. Flagged, not folded in.
  color_name: capsTextNullable(),
  /**
   * STILL IN THE SCHEMA THOUGH NOTHING ON SCREEN SETS IT (0403). Unlike the
   * withdrawn HEADER fields above, a child grid is deleted and reinserted
   * wholesale by `writeChildren` — so a field dropped from this input is
   * nulled on the next save rather than frozen. Keeping it is what makes the
   * freeze real.
   */
  color_id: uuidN,
});

export const amendmentPrintInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  print_id: uuidN,
});

export const amendmentStructureInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  structure_id: uuidN,
});

export const amendmentComboInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
});

export const amendmentPriceDetailInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  price_type: nullableText,
  unit: nullableText,
  price: num,
});

export const amendmentApprovalQtyInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  approval_qty: num,
});

/**
 * NOT `z.enum(PACK_TYPE_OPTIONS)`. The column has no CHECK for the reason given
 * above, and a Zod enum here would put the constraint back one layer up — a
 * document saved under an older wording would fail validation on every save,
 * with a message naming a field the operator cannot see is wrong. Same
 * reasoning as `price_type`, which is `nullableText` beside it.
 */
export const amendmentPackTypeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  pack_type: nullableText,
});

export const amendmentQuantityInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  country_id: uuidN,
  style_ref_no: nullableText,
  style_no: nullableText,
  consignee_id: uuidN,
  assortment_type_id: uuidN,
  po_qty: num,
  // Dates are plain ISO strings here, as everywhere in this module — the input
  // is `<input type="date">`, whose value is always ISO regardless of the
  // browser's display locale.
  delivery_date: nullableText,
  earlier_shipment_date: nullableText,
  warehouse_id: uuidN,
  discharge_port_id: uuidN,
});

export const amendmentCountrySizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  countrywise: z.boolean().default(false),
});

export const amendmentInput = z.object({
  is_draft: z.boolean().default(false),
  // order header
  /**
   * THE SC NO IS MINTED, NOT PICKED (client 2026-08-11).
   *
   * This was `z.string().uuid("Select the SC No")` while the screen's SCNo was a
   * dropdown of orders that already existed — which is amendment behaviour. It
   * is the garment order ENTRY screen, so its SC No is its own identity and the
   * operator cannot supply it: `createAmendment` creates the `sales_orders` row,
   * the 0395 trigger numbers it, and the id comes back here.
   *
   * Null on CREATE, always set afterwards. `location_id` below carries the
   * requiredness this field used to carry — see its note for why it has to.
   */
  sales_order_id: z.string().uuid().nullable().default(null),
  /**
   * NOT A COLUMN on `garment_order_amendments` — `headerOnly()` strips it. It
   * exists to reach `sales_orders.location_id`, and it is mandatory because
   * 0395 numbers per (location, fiscal year): `assign_order_number()` refuses a
   * blank one rather than invent a shared bucket, so without this the insert
   * fails with a raw `23502` instead of a message the operator can act on.
   *
   * This is where SCNo's old requiredness went. A `readOnly` field never holds
   * the cursor (AGENTS.md, "Mandatory fields"), so an auto SC No cannot carry a
   * `*` — the rule is to require its SOURCES instead, exactly as a composed
   * name does.
   *
   * NULLABLE HERE, REQUIRED WHERE IT IS ACTUALLY NEEDED — inside
   * `createAmendment`, on the branch that mints a number. Typed non-nullable it
   * would cage the operator on an EDIT: a document whose order predates the
   * per-location numbering has `sales_orders.location_id` null, the field is
   * read-only once saved, and the record would fail validation on every save
   * with nothing on screen they could change. Requiring a value that only the
   * create path consumes is the "requiring a hidden field" failure AGENTS.md
   * names, one step removed.
   */
  location_id: z.string().uuid().nullable().default(null),
  amend_date: z.string().min(1, "Date is required"),
  // 0404: points at `customers`, the master the business maintains — not the
  // scaffold's `buyers`, which offered demo rows and could not reach ASMARA /
  // OXBOW at all. Renamed as well as repointed; a `buyer_id` holding a customer
  // uuid is the FK landmine 0355 and 0375/0376 were written to clear up.
  customer_id: z.string().uuid("Customer is required"),
  po_no: nullableText,
  po_date: nullableText,
  merchandiser_id: uuidN,
  season: nullableText,
  amend_year: z.coerce.number().int().nullable().default(null),
  delivery_date: nullableText,
  excess_pct: num,
  pack: z.boolean().default(false),
  mult_ord: z.boolean().default(false),
  /**
   * WITHDRAWN FROM THE FORM (client), and therefore from this schema.
   *
   * 2026-08-10 — `department_id`, `agent_id`, `received_mode`, the whole
   * `charges` child and `cd1_pct … cd3_days`. 2026-08-11 — `initiated`, the
   * Order Info "Initiated" dropdown, and `amend_type`, its "Type" dropdown
   * (Garment / Fabric / Made-ups: the company only makes garments, so the field
   * had one answer). Their COLUMNS and their stored values are untouched.
   *
   * Leaving them OUT OF THE SCHEMA is the half that matters: a field left here
   * with a `.default()` is written by `headerOnly(p.data)` on every update, so
   * it would null out what it no longer collects. Same reasoning as
   * `commodity_id` in lib/masters/process-types.ts.
   */
  // logistic scalars
  ship_type_id: uuidN,
  contact_id: uuidN,
  logi_po_date: nullableText,
  ship_mode: nullableText,
  country_id: uuidN,
  currency_code: nullableText,
  received_date: nullableText,
  pay_mode: nullableText,
  pay_terms_id: uuidN,
  ex_rate: num,
  avg_rate: num,
  gross_value: num,
  // reason ("Amendment In" panel)
  amend_in_material_bom: z.boolean().default(false),
  amend_in_fabric_bom: z.boolean().default(false),
  amend_in_garment_process_bom: z.boolean().default(false),
  reason_text: nullableText,
  // children
  style_prices: z.array(amendmentStylePriceInput).default([]),
  styles: z.array(amendmentStyleInput).default([]),
  dyeings: z.array(amendmentDyeingInput).default([]),
  prints: z.array(amendmentPrintInput).default([]),
  structures: z.array(amendmentStructureInput).default([]),
  combos: z.array(amendmentComboInput).default([]),
  price_details: z.array(amendmentPriceDetailInput).default([]),
  approval_qtys: z.array(amendmentApprovalQtyInput).default([]),
  pack_types: z.array(amendmentPackTypeInput).default([]),
  quantities: z.array(amendmentQuantityInput).default([]),
});
export type AmendmentInput = z.infer<typeof amendmentInput>;

export function amendmentStatusTone(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): "warning" | "success" {
  return a.is_draft ? "warning" : "success";
}
export function amendmentStatusText(
  a: Pick<GarmentOrderAmendment, "is_draft">,
): string {
  return a.is_draft ? "Draft" : "Recorded";
}
