import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";
import { isUnitKind, type UnitKind } from "@/lib/orders/styles/rules";
import { styleProcessInput, type ProcessKind } from "./style-processes";

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

/**
 * How a style's price is broken down (client 2026-08-10). "The most critical
 * field in this tab, as it determines how the pricing grid behaves":
 *
 *   Style-wise            one price for the style, whatever the colour or size.
 *   Color-wise            a price per colourway; a neon combo can cost more.
 *   Size-wise             a price per size; 2XL can cost more than S.
 *   Color-wise Size-wise  a price per colour AND size combination (0416).
 *
 * THE FOURTH IS NEW AND THE OTHER THREE ARE UNCHANGED — the client's four modes
 * (2026-08-12) are the original three plus the combination. Stored as text in
 * `garment_order_amendment_price_details.price_type`, which is why this is a
 * plain tuple and not a config_lookups kind: fixed modes the business does not
 * add to, like SHIP_MODES and PAY_MODES below.
 *
 * THE ORDER IS THE READING ORDER, narrowest last. It is also what the Prices
 * grid renders, so re-ordering this re-orders the dropdown.
 *
 * A ROW MAY HOLD A VALUE NOT IN THIS TUPLE — `price_type` has no CHECK, and a
 * `<Select>` matches on value, so a re-worded mode would render a saved row
 * blank. Same trap PACK_TYPE_OPTIONS records above. Re-wording one means
 * migrating the stored rows too.
 */
export const PRICE_TYPE_OPTIONS = [
  "Style-wise",
  "Color-wise",
  "Size-wise",
  "Color-wise Size-wise",
] as const;
export type PriceType = (typeof PRICE_TYPE_OPTIONS)[number];
export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;

/**
 * Color/Print ▸ the Dyeing row's **Type**, and there are TWO lists because the
 * question is not the same one (client 2026-08-17).
 *
 *   Yarn dyeing   → Y/D, Melange
 *   Fabric dyeing → Dyed, Melange
 *
 * Yarn is either dyed as yarn (Y/D) or bought already melange; fabric is
 * piece-dyed after knitting (Dyed) or knitted from melange yarn. "Melange" is in
 * both because a melange fabric IS melange yarn — the same fact stated from
 * either side — and offering it in only one would make the other section
 * unable to describe a perfectly ordinary order.
 *
 * KEYED BY `section`, NOT one merged list, for the reason AGENTS.md's cascading
 * filters section gives: two facets side by side where one answers the other's
 * question. A single list offering Y/D under Fabric dyeing would be offering a
 * value that cannot be right there.
 *
 * NOT TO BE CONFUSED WITH `ITEM_SUB_TYPE_OPTIONS` (combo-rules.ts), which is
 * the STRUCTURE's Fabric Type — Solid / Melange / Yarn Dyed / Printed. That one
 * decides which aesthetic field a component fills (`takesDyedColour`); this one
 * describes how a declared dyeing is done and drives nothing. They share two
 * words and no meaning, so they are deliberately separate constants: merging
 * them would put `printed` and `solid` into a dyeing dropdown and `Y/D` into a
 * rule that tests for `yarn_dyed`.
 */
export const DYE_TYPE_OPTIONS = {
  yarn: ["Y/D", "Melange"],
  fabric: ["Dyed", "Melange"],
} as const;

/**
 * The Type options for one dyeing row, with whatever it already holds.
 *
 * `dye_type` was free TEXT until 2026-08-17, so a stored value need not be in
 * either list. It is appended rather than dropped — the standing rule from
 * AGENTS.md's "Disabled rows": a value the record already holds that the picker
 * no longer offers renders the cell EMPTY, and the next save writes that
 * emptiness over real data.
 *
 * Compared EXACTLY, not case-folded, and that is the subtle half. `<Select>`
 * matches its `value` by exact string, so folding "melange" onto "Melange" here
 * would tidy the list and leave the cell blank — reintroducing the bug this
 * carve-out exists to prevent. A near-duplicate entry is the honest cost.
 *
 * `garment_order_amendment_dyeings` held ZERO rows when this was written, so the
 * carve-out is future-proofing rather than a migration: it protects a value
 * typed between this change and its deploy.
 */
export function dyeTypeOptions(
  section: "yarn" | "fabric",
  held?: string | null,
): string[] {
  const list: string[] = [...DYE_TYPE_OPTIONS[section]];
  const v = held?.trim();
  return v && !list.includes(v) ? [...list, v] : list;
}
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

/**
 * Style(s) tab — one SIZE of one style line (0407).
 *
 * The nested grid under a style row. It belongs to the style by `style_ref_no`,
 * NOT by an id: `writeChildren` reinserts `..._styles` wholesale on every save,
 * so an id would be a different uuid by the time this row was read back. 0407's
 * header carries the full account, and it is the same text key Price Details,
 * Quantities and Approval Qty already resolve on.
 */
export interface AmendmentStyleSize {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  /** `config_lookups` kind 'size' — the same rows `garment_style_sizes` uses. */
  size_id: string | null;
}

/**
 * One process of one style line (0411), read back.
 *
 * Keyed by `style_ref_no` for exactly the reason `AmendmentStyleSize` above is,
 * and the two are written and re-read by the same pass.
 *
 * `kind` is the screen's "Type" — 'garment' or 'component', matching 0411's
 * CHECK. It is NULLABLE here because the column is: a row mid-typing has no
 * answer yet, and the normalizer drops it rather than the database refusing it.
 */
export interface AmendmentStyleProcess {
  id: string;
  amendment_id: string;
  style_ref_no: string | null;
  sno: number;
  kind: ProcessKind | null;
  process_id: string | null;
  /** The cut panel this process is done on; null on a Garment Process (0421). */
  component_id: string | null;
  /** Legacy "Details" — a free-text remark, not a lookup (0412). */
  details: string | null;
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
  /**
   * A fabric CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB (0415).
   *
   * Was `config_lookups` kind 'fabric_structure' (Circular Knit / Flat Knit /
   * Woven), which is the knit FAMILY one level up. 0405 gave this answer for the
   * style master and 0409 for the combo structure row; this grid was the last
   * one on the wrong level, and the level is what lets it be seeded from the
   * order's own style lines rather than retyped.
   */
  structure_id: string | null;
  /**
   * Solid / Melange / Yarn Dyed / Printed (0415) — the client's "see the Type
   * for each fabric structure immediately", and what decides which T&A
   * processing deadlines apply.
   *
   * NULL is a real state, not a missing default: `takesDyedColour` and
   * `takesAllOverPrint` both answer false for it, so an unanswered Type offers
   * neither list. Defaulting to 'solid' would put an invented answer on a row
   * nobody has read yet.
   */
  item_sub_type: string | null;
}

/** Combos tab — a combo row. */
export interface AmendmentCombo {
  id: string;
  amendment_id: string;
  sno: number;
  /** The style this colourway belongs to — read-only, copied from Style(s). */
  style_ref_no: string | null;
  style: string | null;
  article_no: string | null;
  /** The colourway's own name — "WHITE", "NAVY" (0397). */
  combo: string | null;
  /** Legacy shows Combo and ComboDescription as two columns (0408). */
  combo_description: string | null;
  /** The Detail overlay's outer grid (0408). Embedded, not a sibling list. */
  structures: AmendmentComboStructure[];
}

/**
 * Combos ▸ Detail ▸ one fabric structure of one combo (0408 · 0409).
 *
 * MANY PER COMBO. A tee is single jersey in the body and 1x1 rib at the collar,
 * both in the same colourway — which is what corrected 0397's "one combo is one
 * structure" (legacy screenshots 2259 · 2260).
 */
export interface AmendmentComboStructure {
  id: string;
  combo_id: string;
  sno: number;
  /** A fabric CATEGORY (0409) — SINGLE JERSEY, 1X1 LYCRA RIB. */
  structure_id: string | null;
  /** "Type" — 'main' | 'trims_fabric'. NOT the Style master's comp_type. */
  fabric_type: string | null;
  /** "Composition" — `compositions` (0225), an FK since 0408. */
  composition_id: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
  /** "Fabric Type" — 'solid' | 'melange' | 'yarn_dyed'. */
  item_sub_type: string | null;
  /** The overlay's nested grid. */
  components: AmendmentComboComponent[];
  // Gsm Range is DERIVED (`gsmRange` in combo-rules.ts) and has no column.
}

/** Combos ▸ Detail ▸ one garment part made of that structure (0408). */
export interface AmendmentComboComponent {
  id: string;
  structure_id: string;
  sno: number;
  /** `items`, item class GAR (0396) — PIECES, TOP, BOTTOM. */
  coordinate_id: string | null;
  /** The `components` master (0396) — FRONT BODY, COLLAR. */
  component_id: string | null;
  /**
   * "Fabric Color" — TEXT, following 0403, which made the Color/Print tab's own
   * colour free text when Colour Cards was withdrawn as a screen. "Must be a
   * colour this amendment declared" stays a RULE the screen offers rather than
   * a constraint, so an order with no dyeing row yet is guided, not blocked.
   */
  color_name: string | null;
  /**
   * "Fabric Print" — ONE field, not a Fabric and a Print (0410, operator).
   * The legacy header's two words are one label, and it carries one control:
   * the green ⊛ that is this picker's inline create.
   */
  print_id: string | null;
  processed_as_trim: boolean;
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
  /**
   * WHICH colourway this rate is for (0416) — the combo NAME, matching
   * `AmendmentCombo.combo` and the assort line's own `combo`.
   *
   * NULL on a Style-wise or Size-wise row, where the rate is not per colour.
   * With `size_id` beside it this is what lets `orderValue` weight each rate by
   * that combination's quantity instead of refusing to answer at all.
   */
  combo: string | null;
  /** WHICH size this rate is for (0416) — config_lookups kind 'size'. NULL
   *  unless the mode prices by size. */
  size_id: string | null;
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
  /** The colour this line is for (0413). By VALUE from the Combos tab. */
  combo: string | null;
  combo_description: string | null;
  /** Ordered pieces of this combo. Typed — nothing derives it (0413). */
  qty: number;
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
  /**
   * The buyer PO this destination belongs to (0427), asked only while the
   * header's `multi_order` is on. Null on every single-PO order, where the
   * header's own `po_no` answers for the whole document — see the migration.
   */
  po_no: string | null;
  po_qty: number;
  delivery_date: string | null;
  earlier_shipment_date: string | null;
  warehouse_id: string | null;
  discharge_port_id: string | null;
  // ---- the Assort overlay's header (0414) ----
  // One-to-one with this row, so they live ON it rather than in a header table
  // that could only ever have exactly one match. Master/Inner Carton and Pack
  // Description were withdrawn from the amendment HEADER on 2026-08-10, where
  // they were one answer for a whole order; legacy asks them per ASSORTMENT,
  // which is what a quantity row is.
  pack: string | null;
  /** The "Ratio" toggle — true means the size cells are a per-carton ratio. */
  is_ratio_wise_pack: boolean;
  /** 'master' | 'inner' — which carton the ratio is per (0328's tuple). */
  ratio_for: string | null;
  is_single_style_pack: boolean;
  master_carton_name: string | null;
  inner_carton_name: string | null;
  pack_description: string | null;
  /** The Assortments grid — one line per combo. */
  assort_lines: AmendmentAssortLine[];
}

/**
 * Quantities ▸ Assort ▸ one line of the Assortments grid (0414).
 *
 * `pcs_per_pack` is DELIBERATELY ABSENT — it is the sum of the line's size
 * cells (the pieces in one carton), so a field for it would be a second source
 * of truth for an addition. Same rule `gsmRange` follows on the Combos overlay.
 */
export interface AmendmentAssortLine {
  id: string;
  quantity_id: string;
  sno: number;
  /** The colourway, BY VALUE — a combo row's id is rewritten on every save. */
  combo: string | null;
  no_of_cartons: number;
  sizes: AmendmentAssortLineSize[];
}

/** Quantities ▸ Assort ▸ one size cell of one line (0414). */
export interface AmendmentAssortLineSize {
  id: string;
  line_id: string;
  /** `config_lookups` kind 'size' — the same rows 0407 names per style. */
  size_id: string | null;
  /** An explicit 0 is meaningful: "this carton has no XL". */
  qty: number;
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
  /**
   * MULTI STYLE — this PO carries more than one style line.
   *
   * The column keeps the legacy `Mult.Ord` name and the UI says "Multi Style"
   * (client 2026-08-17). What it has always meant here is the number of STYLES:
   * it captions the Style(s) grid and `addStyle` sets it when a second line is
   * added. Renaming the column would rewrite a value every stored row already
   * carries a meaning for, for a label fix — see 0427.
   */
  mult_ord: boolean;
  /** MULTI ORDER — several buyer PO numbers on this one order (0427). Opens the
   *  PO No column on the Quantities tab. Not `mult_ord`; see it above. */
  multi_order: boolean;
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
  /** Which Garment Rejection Rule supplies Approval Qty's Projection (0413). */
  rejection_rule_id: string | null;
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
  style_sizes: AmendmentStyleSize[];
  style_processes: AmendmentStyleProcess[];
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

/**
 * One size of one style line (0407).
 *
 * `style_ref_no` is the row's only link to its style, so it is part of the
 * INPUT rather than something the action derives — the screen knows which style
 * a size sits under and nothing downstream could work it out afterwards.
 *
 * NOT CAPSED. `capsName()` would be wrong twice over: the value here is a uuid,
 * not a name, and the names it resolves to are numeric on this very screen
 * ("2", "3", "14"). The CAPITALS rule reaches the size WORD where it is typed —
 * on the `config_lookups` row itself — not where it is referenced.
 */
export const amendmentStyleSizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  size_id: uuidN,
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
  /**
   * Solid / Melange / Yarn Dyed / Printed (0415).
   *
   * VALIDATED AGAINST THE ONE VOCABULARY rather than left as free text, because
   * `lib/data-io` parses imports with this schema and writes straight to
   * Postgres — an unchecked string would reach the column and be refused by the
   * CHECK as a raw database error rather than a field-level message. `""` maps
   * to null so a cleared `<Select>` reads as "not answered" and not as an
   * invalid member.
   */
  item_sub_type: z
    .enum(["solid", "melange", "yarn_dyed", "printed"])
    .nullable()
    .or(z.literal("").transform(() => null))
    .default(null),
});

/**
 * Combos ▸ Detail ▸ a garment part (0408).
 *
 * CAPS on `color_name`: it is a field VALUE stored in capitals (AGENTS.md,
 * STANDING), and the transform belongs in the schema
 * rather than the action because `lib/data-io` parses imports with these same
 * `*Input` schemas and writes straight to Postgres. `color_name` matches
 * `amendmentDyeingInput.color_name`, which it is meant to agree with.
 */
export const amendmentComboComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  component_id: uuidN,
  color_name: capsTextNullable(),
  print_id: uuidN,
  processed_as_trim: z.boolean().default(false),
});

/**
 * Combos ▸ Detail ▸ a fabric structure (0408 · 0409).
 *
 * NESTED, and the nesting is load-bearing: `structure_id` on a component is a
 * uuid the database assigns during THIS save, so a flat sibling array would
 * have nothing to point at. `writeComboTree` inserts the three levels in order
 * and resolves each level's ids from the one above.
 *
 * The two enums are NOT `z.enum`. Both columns carry a SQL check, and a stored
 * value that stops matching the tuple must render as a stale value the operator
 * can see and re-pick rather than a parse error on a document they are trying
 * to open — the reasoning RECEIPT_MODES records above.
 */
export const amendmentComboStructureInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  structure_id: uuidN,
  fabric_type: nullableText,
  composition_id: uuidN,
  gsm: z.coerce.number().nullable().default(null),
  gsm_tolerance: z.coerce.number().nullable().default(null),
  item_sub_type: nullableText,
  components: z.array(amendmentComboComponentInput).default([]),
});

export const amendmentComboInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  combo: capsTextNullable(),
  combo_description: capsTextNullable(),
  structures: z.array(amendmentComboStructureInput).default([]),
});

export const amendmentPriceDetailInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  price_type: nullableText,
  // NOT validated against the mode. "Color-wise implies a combo" is true of a
  // FINISHED row and false of one being filled in, and a schema that enforced
  // it would reject the save instead of letting the grid say what is missing —
  // the same reason 0416 puts no CHECK on the columns. `styleRate` is where the
  // pairing is judged, because the Save button and the Order Sheet both ask it.
  combo: nullableText,
  size_id: uuidN,
  unit: nullableText,
  price: num,
});

export const amendmentApprovalQtyInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  style: nullableText,
  article_no: nullableText,
  /* The colour breakdown (0413). Not capsed here: `combo` is copied from the
     Combos tab, which is where the value is typed and where the CAPITALS rule
     reaches it — capsing a COPY would let the two disagree if that rule ever
     changed on one side. */
  combo: nullableText,
  combo_description: nullableText,
  qty: num,
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

/**
 * Quantities ▸ Assort ▸ one size cell (0414).
 *
 * `qty` is NOT dropped when zero. A ratio saying "no XL in this carton" is a
 * real statement; the normalizer drops a cell with no SIZE, never one with no
 * quantity.
 */
export const amendmentAssortLineSizeInput = z.object({
  size_id: uuidN,
  qty: num,
});

/** Quantities ▸ Assort ▸ one line of the Assortments grid (0414). */
export const amendmentAssortLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  // CAPS: a colourway name is a field VALUE stored in capitals, and it must
  // match `amendmentComboInput.combo`, which it references by value.
  combo: capsTextNullable(),
  no_of_cartons: num,
  sizes: z.array(amendmentAssortLineSizeInput).default([]),
});

export const amendmentQuantityInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  country_id: uuidN,
  style_ref_no: nullableText,
  style_no: nullableText,
  consignee_id: uuidN,
  assortment_type_id: uuidN,
  /* `nullableText`, NOT `capsTextNullable()`, and deliberately so: this is the
     same PO number the HEADER's `po_no` holds, which is `nullableText` below.
     Capsing one of the two would let the same buyer reference read two ways
     depending on which switch was on when it was typed. */
  po_no: nullableText,
  po_qty: num,
  // Dates are plain ISO strings here, as everywhere in this module — the input
  // is `<input type="date">`, whose value is always ISO regardless of the
  // browser's display locale.
  delivery_date: nullableText,
  earlier_shipment_date: nullableText,
  warehouse_id: uuidN,
  discharge_port_id: uuidN,
  // ---- the Assort overlay (0414) ----
  pack: capsTextNullable(),
  is_ratio_wise_pack: z.boolean().default(false),
  ratio_for: nullableText,
  is_single_style_pack: z.boolean().default(false),
  master_carton_name: capsTextNullable(),
  inner_carton_name: capsTextNullable(),
  pack_description: capsTextNullable(),
  /**
   * NESTED, and the nesting is load-bearing: a line's `quantity_id` is a uuid
   * the database assigns during THIS save, so a flat sibling array would have
   * nothing to point at. `writeAssortTree` inserts the levels in order and
   * resolves each from the one above.
   */
  assort_lines: z.array(amendmentAssortLineInput).default([]),
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
  // `amend_year` WITHDRAWN 2026-08-14 (client): the year is already on the
  // linked Style Master, so the order asked for it twice. Its COLUMN and stored
  // values remain — and it left this input, which is the half that stops an
  // update writing NULL over them. Row type keeps `amend_year` so a saved value
  // still loads and still shows anywhere that reads the record.
  delivery_date: nullableText,
  excess_pct: num,
  pack: z.boolean().default(false),
  /** MULTI STYLE. The column name is the legacy one — see the row type. */
  mult_ord: z.boolean().default(false),
  /** MULTI ORDER (0427) — several buyer POs, one per quantity line. */
  multi_order: z.boolean().default(false),
  /**
   * WITHDRAWN FROM THE FORM (client), and therefore from this schema.
   *
   * 2026-08-12 — `contact_id`, `logi_po_date`, `received_date` and the whole
   * `style_prices` child, which restated the Prices tab: the Logistic tab is
   * Ship Mode / Ship Type / Pay Mode / Payment Terms / Days / Currency /
   * Country and nothing else. `AmendmentStylePrice` and the `style_prices`
   * EMBED both stay — the read side keeps showing what is stored, exactly as
   * `charges` does; it is only the write side that withdraws.
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
  ship_mode: nullableText,
  country_id: uuidN,
  currency_code: nullableText,
  pay_mode: nullableText,
  pay_terms_id: uuidN,
  /* NULL is a real state, not a missing answer: an order with no rule chosen
     has no Projection, and every row predating 0413 is in exactly that state. */
  rejection_rule_id: uuidN,
  ex_rate: num,
  /* NULLABLE SINCE 0417, and calculated rather than typed. `order-value.ts`
     returns null where a style is priced per colour and the rows carry no
     colour column to weight them by — a partial Gross Value reads exactly like
     a correct one, so it refuses instead. `num` here would coerce that null
     back to 0 and reinstate the lie the migration was written to remove. */
  avg_rate: z.coerce.number().nullable().default(null),
  gross_value: z.coerce.number().nullable().default(null),
  // reason ("Amendment In" panel)
  amend_in_material_bom: z.boolean().default(false),
  amend_in_fabric_bom: z.boolean().default(false),
  amend_in_garment_process_bom: z.boolean().default(false),
  reason_text: nullableText,
  // children
  styles: z.array(amendmentStyleInput).default([]),
  style_sizes: z.array(amendmentStyleSizeInput).default([]),
  /**
   * The per-style Process list (0411). Flat and keyed by `style_ref_no`, the
   * same shape `style_sizes` takes and for the same reason — the screen nests
   * these under their style row and flattens on submit.
   *
   * The schema is imported rather than restated: `style-processes.ts` is
   * client-safe and the picker's narrowing already reads its `ProcessKind`,
   * so declaring the two values a second time here is how a CHECK and a Zod
   * enum drift apart.
   */
  style_processes: z.array(styleProcessInput).default([]),
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
