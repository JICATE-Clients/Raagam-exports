import { z } from "zod";
import { REQUIREMENT_BASES } from "@/lib/orders/material-bom/requirement";
import { AXES, canonicalAxes, type Axis } from "@/lib/orders/bom-explosion/exploder";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ Material BOM (0265, reshaped by 0418). Step 3 of the client's
// six-step garment order flow: every sewing and packing accessory a confirmed
// order needs, and how much of each.
//
// Header + three children — Items, Processes, and the STORED requirement the
// Items grid explodes into. The requirement is not typed and not projected; it
// is computed by `lib/orders/material-bom/requirement.ts` on save. See 0418 for
// why it is stored rather than derived on read.
//
// KEYED TO `garment_order_amendments`, NOT `sales_orders` (0418). The production
// target this multiplies — order qty + excess + approval + projection — lives on
// the garment order's Approval Qty tab. `sales_order_id` keeps its column and
// its data and has left this input; the SC No is read through the order.
// ============================================================================

/**
 * Provisional fixed dropdown. LOWERCASE MATTERS HERE: `nominatedVendorOptions()`
 * lower-cases before comparing, because the same word is spelled "Nominated"
 * in this list and "nominated" in Orders and Planning — AGENTS.md's
 * "Nominated vendors" section records that a `===` at a call site compiles,
 * runs and quietly matches nothing.
 */
export const SUPPLY_TYPE_OPTIONS = ["Local", "Import", "Nominated", "Free Issue"] as const;

/**
 * WHAT A NEW BOM LINE OPENS ON (client 2026-08-21: "a Vendor dropdown is
 * required. By default, it is Local").
 *
 * IT IS NOT COSMETIC. A blank supply type offers **zero** vendors — deliberately,
 * because `nominatedVendorOptions()` refuses to guess and says "Pick Supply Type
 * first" instead (AGENTS.md records that a guard phrased as "restrict only in
 * case X" leaked the whole vendor list through every state that was not X). So
 * blank left the operator looking at a dropdown that opens onto nothing on every
 * fresh line, and Local is both the ordinary case and the one that makes the
 * field beside it usable.
 *
 * A DEFAULT, NOT A CONSTRAINT. `supply_type` is still not `required` — marking it
 * so would hold the keyboard cursor on every line — and the value stays freely
 * changeable. Same shape as `DEFAULT_MATERIAL_TYPE` above.
 */
export const DEFAULT_SUPPLY_TYPE: (typeof SUPPLY_TYPE_OPTIONS)[number] = "Local";

/**
 * The Items grid's "Type" — how settled this line's material is.
 *
 * RESTORED 2026-08-17 ON THE CLIENT'S WRITTEN INSTRUCTION, and the history
 * matters because a column coming back with no note beside it reads as drift:
 * this list held `["Production", "Sample", "Trial"]`, c756d82 withdrew the cell
 * that morning as part of a 22 → 19 column streamlining and called the option
 * list provisional, and the SAME client drop asked for these three words in the
 * item section. So the withdrawal was of a wrong vocabulary, and this is the
 * right one — they REPLACE the old three rather than joining them.
 *
 * That restoration cost one grid column and nothing else because the withdrawal
 * kept the DB column, the stored values and `mbaItemInput.type`. There is no
 * migration: `material_bom_amendment_items.type` is plain `text` with no CHECK
 * (0265) and nothing has altered it since.
 *
 * NOT CAPITALISED. "To be advised" is mixed case by design; AGENTS.md's CAPITALS
 * rule governs typed free text (`<Input uppercase>` + `capsName()` in the
 * schema), not a fixed option list — the same exemption workflow status keys
 * take. `type` stays `nullableText` in the input for that reason.
 */
export const MATERIAL_TYPE_OPTIONS = [
  "To be advised",
  "To be developed",
  "Available Item",
] as const;

/**
 * WHAT A NEW BOM LINE STARTS AS (client 2026-08-21: "type field default set as
 * Available Item, if may need user can update it").
 *
 * The ordinary case, and stating it here rather than typing the literal into
 * `blankItem` is what keeps the default from drifting off the option list — a
 * string that stops matching an option renders as a blank `<Select>` with a
 * value behind it, which is worse than no default at all.
 *
 * A DEFAULT, NOT A CONSTRAINT. `type` is still not `required`, the empty option
 * stays on the list, and nothing rewrites a STORED value: a line saved with a
 * blank type before this existed loads blank, because filling it in on read
 * would silently change what the next save writes.
 */
export const DEFAULT_MATERIAL_TYPE: (typeof MATERIAL_TYPE_OPTIONS)[number] = "Available Item";

/** Where a material sent out for processing has got to. */
export const PROCESS_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "sent", label: "Sent" },
  { value: "part_received", label: "Part received" },
  { value: "received", label: "Received" },
] as const;

/** How the Attribute column splits a requirement. Labels only — the VALUES are
 *  `REQUIREMENT_BASES`, which the CHECK constraint and the engine share. */
export const REQUIREMENT_BASIS_LABELS: Record<(typeof REQUIREMENT_BASES)[number], string> = {
  /* "ORDER" AND "STYLE", BOTH KEPT (client 2026-08-21). Their note read
     "Style (formerly Order Number): generates a single bulk row for the entire
     style quantity", which would have put two options called Style side by side
     — `style` already means one row per style. Confirmed with them: the bulk row
     is "Order", the per-style split is "Style", and they differ only on a
     multi-style order.
     WORDING ONLY. The column stores the KEY; this map owns the label, which is
     the split 0418 asserts with a test that fails if the CHECK ever admits a
     label like "Color-wise". */
  order: "Order",
  style: "Style",
  colour: "Color-wise",
  size: "Size-wise",
  combination: "Combination (Color + Size)",
  /* THE DESTINATION AXIS. Worded as a plain "Country-wise" to sit beside the
     others, but it answers a different question — see REQUIREMENT_BASES. */
  country: "Country-wise",
};

/**
 * ## THE THREE COLUMNS WITHDRAWN ON 2026-08-17 ARE ALL BACK, WHICH IS WHY A
 * ## WITHDRAWAL HERE IS NEVER A DELETION
 *
 * "UI streamlining" took `type`, `alternate_uom_id` and `combination` off the
 * Items grid to shorten a 22-column row. `type` returned the same day with a
 * corrected option list; the other two returned on 2026-08-19, when the client
 * asked for the item row in legacy's order column-for-column (screenshot 2362).
 *
 * Each restoration cost one grid column and nothing else — no migration, no
 * change here — because the withdrawals kept the DB columns, the stored values
 * and the place in `mbaItemInput`. That is not tidiness: `writeChildren` DELETES
 * AND REINSERTS every child row, so a field the form stops carrying is a field
 * the next save destroys. 0418's pattern for `attribute_id`, and the one
 * AGENTS.md records for `amend_type`.
 *
 * None of the three ever reached `lib/orders/material-bom/requirement.ts`, so
 * nothing computed changed in either direction.
 */
export interface MbaItem {
  id: string;
  amendment_id: string;
  sno: number;
  /**
   * A `public.categories` id since 0426 — BUTTON, LABEL, POLY BAG. NOT a
   * `config_lookups` row of kind `material_category`, which holds the two GROUP
   * names ("Sewing Accessory", "Packing Accessory") and was all this cell could
   * offer until then (client 2026-08-17, screenshot 2314).
   *
   * It is the same master `items.category_id` has pointed at since 0226, and
   * that is the point: the two are comparable, so this cell narrows the Material
   * picker beside it (`materialsForCategory`). Both accessory classes are
   * offered together — a BOM line has no item class of its own.
   */
  category_id: string | null;
  /** How settled this line's material is — `MATERIAL_TYPE_OPTIONS`. Withdrawn
   *  from the grid on the morning of 2026-08-17 and restored the same day with
   *  the corrected option list, on the client's instruction; see that constant
   *  for why the two are one decision rather than a flip-flop. */
  type: string | null;
  item_id: string | null;
  /** Classification only. It does NOT drive the split — see `requirement_basis`
   *  and 0418's header for the four reasons a `config_lookups` row cannot. */
  attribute_id: string | null;
  /**
   * The trim's colour, from `config_lookups` kind `fabric_color` — the SAME list
   * the garment's colours come from, so "match the thread to the fabric" is a
   * comparison rather than a string reconciliation.
   *
   * NULL IS A MEANING. On a colour-wise line it means "takes the garment's
   * combo colour", which is the ordinary case and the reason the operator chose
   * Color-wise. A value pins a CONTRAST colour across every exploded row.
   */
  item_color_id: string | null;
  /** Free CAPS text: WOVEN 2-FOLD, NYLON #5. */
  specification: string | null;
  /** The MATERIAL's size (50MM X 20MM), NOT the garment size a size-wise line
   *  explodes along — different axes, so different storage (0419). */
  size: string | null;
  /** 'order' | 'colour' | 'size'. */
  requirement_basis: string | null;
  /**
   * THE EXPLOSION GRAIN AS A SET OF AXES (0455), and the source of truth since
   * 2026-08-23. `requirement_basis` above is kept and still written wherever the
   * grain has one of the six legacy names — eight of the nine producible grains
   * do — so nothing that reads it stops working.
   *
   * NULL is "not chosen yet" and REFUSES; `[]` is the WHOLE ORDER, which is a
   * real answer. The two must not be conflated: a default of `[]` would make
   * every new line silently mean "one bulk row for the order" and delete the
   * refusal that tells the operator to answer.
   */
  requirement_grain: string[] | null;
  /** Which style this line is for; null = every style. By VALUE (0407). */
  style_ref_no: string | null;
  /**
   * Which garment PANEL this material goes on — front body, sleeve, collar
   * (0423). From the components master, narrowed on screen to the parts the
   * line's style declares.
   *
   * DESCRIPTIVE. It does not split the requirement: one collar interlining is
   * needed per garment whichever panel it is cut for, so a component axis would
   * multiply rows without changing the total. `productionSlices` is untouched
   * and `material_bom_amendment_requirements` has no component column — 0423
   * asserts that second half, because the decision is only safe while it holds.
   */
  component_id: string | null;
  supply_type: string | null;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  /** Legacy's third unit beside Consumption and Purchase. Off the grid
   *  2026-08-17, back on it 2026-08-19 with legacy's row order. Nothing reads
   *  it: the engine converts consumption → purchase and never consults a third
   *  unit. */
  alternate_uom_id: string | null;
  /** Which pack size this line buys, e.g. the 2,500 m cone rather than the
   *  5,000 m one (0348). It cannot live on the material: items.purchase_uom_id
   *  holds a single UOM ("Cone") and cannot tell two cone sizes apart, so the
   *  choice belongs to the BOM line. */
  uom_conversion_id: string | null;
  /** Free text that collides by name with `requirement_basis = 'combination'`
   *  (0420, colour x size) while having nothing to do with it. That collision is
   *  why it left the grid on 2026-08-17; the client had it back on 2026-08-19
   *  with legacy's row, so `REQUIREMENT_BASIS_LABELS.combination` keeps its
   *  "(Color + Size)" qualifier as the only thing distinguishing the two. */
  combination: string | null;
  moq: number | null;
  /** Round the post-MOQ figure UP to the next multiple of this (0437).
   *  NULL = no rounding asked for, which is every row before 0437. */
  round_to: number | null;
  /** The NUMERATOR — how many are used. Renamed from `quantity_nos` by 0418. */
  no_of_items: number | null;
  /** The DIVISOR — how many garments they cover. */
  per_pieces: number | null;
  /** This line's wastage buffer, shown as "Wastage %". */
  excess_pct: number | null;
  required_by: string | null;
  /**
   * PER-PANEL CONSTRUCTION (0436), the Combination sheet's rows. EMPTY IS THE
   * ORDINARY CASE and means "this line's own `no_of_items` / `per_pieces`
   * apply to the whole garment" — the opt-in half of 0436, which is what keeps
   * every line written before it unchanged.
   */
  components: MbaItemComponent[];
  /**
   * PER-SLICE CONSUMPTION OVERRIDES (0442). Empty is the ordinary state and
   * means "the line's own figures apply to every slice" — the opt-in half.
   */
  slices: MbaItemSlice[];
}

/**
 * One panel's share of a Material BOM line (0436).
 *
 * WHY THIS EXISTS AT ALL: a sleeve seam is shorter than a front seam, so thread
 * consumption genuinely differs by panel. 0423 rejected a component axis on the
 * premise that it never does ("one collar interlining per garment whichever
 * panel it is cut for") — true of interlining, false of thread. Read 0436's
 * header before adding a fifth `requirement_basis` for this; it deliberately is
 * not one.
 */
export interface MbaItemComponent {
  id: string;
  item_line_id: string;
  sno: number;
  component_id: string;
  /** The trim's colour ON THIS PANEL. NULL means the line's own Item Color.
   *  Two colours under one line are two things to buy, so they become two
   *  requirement rows — see `MbaRequirement.item_color_id`. */
  item_color_id: string | null;
  no_of_items: number;
  /** Never defaulted to 1 — CHECKed `> 0` in the column (0436), same rule 0418
   *  states for the line. */
  per_pieces: number;
}

/**
 * ONE SLICE'S CONSUMPTION OVERRIDE on a Material BOM line (0442).
 *
 * NOT A ROW OF THE GRID — the grid's rows come from `productionSlices()`, which
 * the Requirement section already computes. This is only what an operator TYPED
 * against one of them.
 *
 * BOTH FIGURES ARE NULLABLE AND NULL MEANS "INHERIT". A blank cell uses the
 * line's own `no_of_items` / `per_pieces`, which stay typeable and act as the
 * default (client 2026-08-21). That is why neither is defaulted to 0 or 1: a
 * default would make "not answered" indistinguishable from "answered with that",
 * and the line's figure would stop reaching the slice.
 *
 * KEYED ON (combo, size_id), the same pair `price_details` uses — `combo` by
 * NAME because a colourway is a name on the Combos tab, `size_id` as a lookup
 * because a size is a `config_lookups` row Quantities already keys on. A basis
 * with no colour axis leaves `combo` null, and one with no size axis leaves
 * `size_id` null.
 */
export interface MbaItemSlice {
  id: string;
  item_line_id: string;
  sno: number;
  combo: string | null;
  size_id: string | null;
  /** The destination (0449) — part of the key, not decoration. */
  country_id: string | null;
  /** Legacy's Combination: the garment part typed in the popup (0463). NULL on
   *  every row that is not a combination split, which is most of them. Part of
   *  the key — see `SliceKey` for why leaving it out silently mixes TOP with
   *  BOTTOM. */
  combination: string | null;
  /** Which style this override is for (0464). Part of the key: without it every
   *  style on a style-basis line shared one typed figure. */
  style_ref_no: string | null;
  chosen: boolean;
  size_wise: boolean;
  item_color_id: string | null;
  specification: string | null;
  size_spec: string | null;
  /** The wastage buffer for this row (0450). NULL inherits the line's. */
  excess_pct: number | null;
  /** The minimum and step for this row (0451). NULL inherits the line's. */
  moq: number | null;
  round_to: number | null;
  no_of_items: number | null;
  per_pieces: number | null;
}

export interface MbaProcess {
  id: string;
  amendment_id: string;
  sno: number;
  /** The row's immutable anchor (0446) — see `mbaProcessInput.row_uid`. */
  row_uid: string;
  item_id: string | null;
  process_id: string | null;
  vendor_id: string | null;
  qty_out: number | null;
  qty_in: number | null;
  status: string;
  /* LEGACY'S FIVE (0465). They sit beside the lifecycle above rather than
     replacing it — the client's explicit call, since `chain.ts` walks the
     lifecycle and a Delivery Challan is raised from it. */
  /** What the material becomes at this step ("DYED"). */
  stage: string | null;
  /** Legacy's "For". A dropdown there, text here — one observed value is not a
   *  vocabulary; see the column comment. */
  for_scope: string | null;
  description: string | null;
  /** DISPLAYED, NOT COMPUTED. Nothing reads this into a quantity yet, and
   *  wiring it would change every purchase on a BOM carrying a process. */
  loss_pct: number | null;
  notes: string | null;
}

/** One stored requirement row. Written by the server, never by the form. */
export interface MbaRequirement {
  id: string;
  amendment_id: string;
  item_line_id: string;
  item_id: string | null;
  sno: number;
  /** The LEGACY grain name. NULLABLE since 0456: a composed grain has no name
   *  among the six, and `requirement_grain` beside it is the provenance. */
  basis: string | null;
  /** The grain that produced this row (0456), canonical. */
  requirement_grain: string[] | null;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  /**
   * The TRIM's own colour, not the garment combo above it (0436).
   *
   * It was SHOWN AND NEVER STORED until then: the Requirement tab computes an
   * Item Color in `colourOf` and throws it away on save, so a purchase order had
   * no colour to be checked against. Harmless while one line meant one colour;
   * a wrong purchase the moment a line's panels carry two.
   */
  item_color_id: string | null;
  slice_label: string;
  basis_qty: number;
  no_of_items: number;
  per_pieces: number;
  excess_pct: number;
  /** NULL means REFUSED — never "none needed". `refusal_reason` says which case. */
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
  uom_conversion_id: string | null;
  purchase_qty: number | null;
  purchase_uom_id: string | null;
}

/** The order a BOM plans for, as much of it as the list and editor need. */
export type BomGarmentOrder = {
  id: string;
  code: string | null;
  po_no: string | null;
  amend_date: string;
  delivery_date: string | null;
  excess_pct: number;
  rejection_rule_id: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  /** The SC No, stamped on the minted shell by 0395. */
  sales_order: { id: string; order_number: string | null } | null;
};

export interface MaterialBomAmendment {
  id: string;
  code: string | null;
  garment_order_id: string | null;
  /** WITHDRAWN from the input by 0418; still selected so nothing that reads the
   *  row breaks, and so a pre-0418 record keeps pointing where it pointed. */
  sales_order_id: string | null;
  customer_id: string | null;
  amendment_no: number;
  amend_date: string;
  is_draft: boolean;
  remarks: string | null;
  computed_at: string | null;
  computed_for_qty: number | null;
  computed_basis_hash: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  garment_order?: BomGarmentOrder | null;
  customer?: { id: string; code: string | null; name: string } | null;
  items: MbaItem[];
  processes: MbaProcess[];
  requirements: MbaRequirement[];
  /** Challan lines raised from this BOM's Processes tab (0446). */
  dc_lines?: MbaDcLine[];
}

/**
 * One Delivery Challan line generated from a Processes row (0446).
 *
 * Keyed by `mba_process_row_uid`, never by the process row's `id` — that id is
 * destroyed and re-minted on every save (`writeChildren`), so a link through it
 * would come unstuck the first time the BOM was edited.
 */
export interface MbaDcLine {
  mba_process_row_uid: string | null;
  sent_qty: number | null;
  returned_qty: number | null;
  delivery_challan_id: string;
  challan: {
    code: string | null;
    dc_date: string | null;
    status: string | null;
    stock_posted_at: string | null;
  } | null;
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

/**
 * One row of the Combination sheet (0436).
 *
 * `per_pieces` is `.positive()` rather than merely non-null, which mirrors the
 * column's CHECK — and the rule lives HERE rather than in the action for the
 * reason the whole file repeats: `lib/data-io` parses with these schemas and
 * writes straight to Postgres.
 */
export const mbaItemComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  component_id: z.string().uuid(),
  item_color_id: uuidN,
  no_of_items: z.coerce.number().nonnegative(),
  per_pieces: z.coerce.number().positive("Pieces must be more than 0"),
});

/**
 * An override as it arrives from the form. No `id` and no `item_line_id` — the
 * first is the database's and the second is only known after the parent line is
 * inserted (`actions.ts` resolves it through the `sno` map).
 *
 * `.nullable()` ON THE FIGURES, never `.default(...)`: NULL is "inherit the
 * line's", so a default would silently answer a question nobody asked. The
 * positive check on `per_pieces` matches the column's CHECK, which also guards
 * on NULL first.
 */
export const mbaItemSliceInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  combo: nullableText,
  size_id: uuidN,
  /** The destination — PART OF THE KEY since 0449, or two countries' same-size
   *  rows resolve to each other. */
  country_id: uuidN,
  /** Legacy's Combination — a garment part TYPED in the popup (0463), free text
   *  and deliberately not `combo` above, which is the colourway by name and is
   *  joined on by the composer. `capsTextNullable` rather than `nullableText`
   *  because the transform belongs in the schema: `lib/data-io` parses with
   *  these same schemas and writes straight to Postgres, so an action-level
   *  `.toUpperCase()` would miss every import path that ever gets added. */
  combination: capsTextNullable(),
  /** Which style (0464) — PART OF THE KEY, or two styles on one line resolve to
   *  each other's figure. `nullableText` and NOT `capsTextNullable`: a style ref
   *  is matched by EQUALITY against `sales_order_*.style_ref_no` and against
   *  `material_bom_amendment_requirements.style_ref_no`, neither of which is
   *  re-cased, so upper-casing it here would be this module inventing a spelling
   *  the rest of Orders does not use. */
  style_ref_no: nullableText,
  /** Legacy's "Choose" tick. FALSE means this row buys none of the material. */
  chosen: z.coerce.boolean().default(true),
  /** Legacy's "Size wise" tick — splits THIS row into its sizes. */
  size_wise: z.coerce.boolean().default(false),
  item_color_id: uuidN,
  specification: capsTextNullable(),
  size_spec: capsTextNullable(),
  /** The wastage buffer for this row (0450). NULL inherits the line's, the same
   *  contract the two figures have carried since 0442. */
  excess_pct: z.coerce.number().min(0).max(100).nullable().default(null),
  /** The supplier minimum and rounding step for this row (0451). NULL inherits
   *  the line's — see the column comments for why per-row is a risk. */
  moq: z.coerce.number().nonnegative().nullable().default(null),
  round_to: z.coerce.number().nonnegative().nullable().default(null),
  no_of_items: z.coerce.number().nonnegative().nullable().default(null),
  per_pieces: z.coerce
    .number()
    .positive("Pieces must be more than 0")
    .nullable()
    .default(null),
});

/**
 * WHAT A MATERIAL LINE CANNOT BE SAVED WITHOUT — declared ONCE.
 *
 * AGENTS.md's "Mandatory fields" rule is that `required` is stated once and four
 * enforcers read it: the red `*`, the cursor hold, the Save button and the server
 * action. This is the shape `missingRequiredMaterialFields` in
 * `lib/masters/material-types.ts` already uses, and it is here for the same
 * reason — the Zod `superRefine` below and the screen's "+ Add material" gate ask
 * the same question, and two copies of it would answer differently the first time
 * one was edited.
 *
 * ## THE FIGURES ARRIVE ALREADY PARSED
 *
 * The screen holds `no_of_items` and `per_pieces` as STRINGS (a number cannot
 * represent a box the operator has just cleared), the payload holds them as
 * numbers. Taking `number | null` means the caller does the one conversion it
 * already does anyway, rather than this function guessing which shape it has.
 *
 * ## GATED ON A MATERIAL BEING NAMED
 *
 * An entirely blank row is how a grid opens and is dropped by `normalizeItems`
 * before it reaches the database; refusing it would make an untouched line block
 * Save. So a row with no `item_id` is missing NOTHING — which is also what lets
 * the "+ Add material" gate use this without refusing the very first line.
 */
export type ItemRequiredCheck = {
  category_id: string | null;
  item_id: string | null;
  requirement_grain?: readonly string[] | null;
  requirement_basis?: string | null;
  no_of_items: number | null;
  per_pieces: number | null;
};

export function missingItemFields(
  v: ItemRequiredCheck,
): { path: string; label: string; message: string }[] {
  if (!v.item_id) return [];
  const out: { path: string; label: string; message: string }[] = [];

  /* CATEGORY (client 2026-08-24). It was already the field that NARROWS the
     Material picker — `materialsFor(category_id, …)` — so a line naming a
     material almost always has one; almost is what this closes. */
  if (!v.category_id) {
    out.push({ path: "category_id", label: "Category", message: "Choose a category" });
  }
  if (v.no_of_items == null || v.no_of_items <= 0) {
    out.push({
      path: "no_of_items",
      label: "No. of Items",
      message: "Enter how many are used per piece",
    });
  }
  // Not defaulted to 1 anywhere — in the column (0418), in the input, or in the
  // engine. A default makes an unfinished line compute, and the number it
  // produces goes onto a real purchase order.
  if (v.per_pieces == null || v.per_pieces <= 0) {
    out.push({ path: "per_pieces", label: "Per Pieces", message: "Pieces must be more than 0" });
  }
  /* THE GRAIN SATISFIES IT, and `[]` is a real answer (the whole order) — so
     this tests for NULL, not for emptiness. `!grain?.length` would refuse the
     answer an operator picks most often. */
  if (!v.requirement_basis && (v.requirement_grain ?? null) === null) {
    out.push({
      path: "requirement_basis",
      label: "Attribute",
      message: "Choose how this material splits",
    });
  }
  return out;
}

export const mbaItemInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    category_id: uuidN,
    type: nullableText,
    item_id: uuidN,
    attribute_id: uuidN,
    item_color_id: uuidN,
    // CAPS in the SCHEMA, not the action: `lib/data-io` parses imports with this
    // same schema and writes straight to Postgres, so an action-level
    // `.toUpperCase()` misses every spreadsheet import (AGENTS.md, "CAPITALS").
    specification: capsTextNullable(),
    size: capsTextNullable(),
    requirement_basis: z.enum(REQUIREMENT_BASES).nullable().default(null),
    /**
     * THE GRAIN, CANONICALISED IN THE SCHEMA rather than in the action.
     *
     * `chk_mba_item_grain_canonical` compares the stored array against
     * `mba_canonical_grain()`, so a payload that arrives unsorted or with a
     * repeat is rejected by Postgres with a constraint name nobody can read.
     * Canonicalising here means the form and the database agree by construction
     * — the same argument AGENTS.md makes for putting the CAPITALS transform in
     * Zod rather than in the action.
     *
     * `z.enum(AXES)` and not `z.string()`: an unknown axis must fail with a
     * sentence naming the field, not sail through to a CHECK violation.
     */
    requirement_grain: z
      .array(z.enum(AXES))
      .nullable()
      .default(null)
      .transform((v) => (v === null ? null : canonicalAxes(v as Axis[]))),
    style_ref_no: nullableText,
    component_id: uuidN,
    supply_type: nullableText,
    vendor_id: uuidN,
    purchase_uom_id: uuidN,
    consumption_uom_id: uuidN,
    alternate_uom_id: uuidN,
    uom_conversion_id: uuidN,
    combination: nullableText,
    moq: numN,
    round_to: numN,
    no_of_items: numN,
    per_pieces: numN,
    excess_pct: z.coerce.number().min(0).max(100).nullable().default(0),
    required_by: nullableText,
    /** The Combination sheet's rows (0436). Defaulted to `[]`, never required:
     *  the opt-in is what keeps every line written before 0436 valid. */
    components: z.array(mbaItemComponentInput).default([]),
    /** The per-slice overrides (0442). Defaulted to `[]` for the same reason
     *  `components` is: every line written before this stays valid. */
    slices: z.array(mbaItemSliceInput).default([]),
  })
  /**
   * THE LINE RULES LIVE IN THE SCHEMA, NOT IN THE ACTION.
   *
   * `lib/data-io` parses imports with these same `*Input` schemas and writes
   * straight to Postgres, so a rule enforced only in the server action misses
   * every spreadsheet import — the identical argument AGENTS.md makes for
   * putting the CAPITALS transform in Zod rather than in the action.
   *
   * Gated on a material being NAMED. An entirely blank row is how a grid opens
   * and is dropped by `normalizeItems` before it reaches the database; refusing
   * it here would make an untouched blank line block Save.
   */
  .superRefine((v, ctx) => {
    /* EVERY REQUIRED FIELD COMES FROM `missingItemFields`, so this action and the
       screen's "+ Add material" gate cannot disagree about what a finished line
       is. The four checks that used to be written out here moved there whole. */
    for (const m of missingItemFields(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [m.path], message: m.message });
    }

    /**
     * TWO PANELS OF THE SAME COLOUR ARE ONE PURCHASE, so naming one twice
     * silently DOUBLES the line's rate rather than failing — the quietest way
     * this table can be wrong. The column has the same unique index; this is the
     * half that answers with a sentence instead of a Postgres error, and the
     * half a spreadsheet import meets first.
     */
    /* ONE OVERRIDE PER SLICE, mirroring `uq_mba_slice_line_combo_size`. The
       index COALESCEs every key because a NULL never collides in Postgres; here
       `?? ""` does the same job, and the two must agree.

       ## THREE AXES, AND THE THIRD WAS MISSING UNTIL 2026-08-23

       The index gained `country_id` in 0449 — which even asserts it, "the slice
       key does not include country_id — USA-M and CH-M would collide" — and this
       mirror of it did not. The drift ran the OPPOSITE way to the one the
       original note feared: not the form accepting a pair the database refuses,
       but the form REFUSING a pair the database allows. Two destinations at one
       size are a legitimate, ordinary country-wise entry, and typing a figure
       against the second produced "This slice already has an override on the
       line" and blocked Save with no way forward.

       Kept in step with `sliceKey` in `slice-consumption.ts`, which reads the
       same three axes: a mirror that names fewer is a mirror that is wrong. */
    const seenSlice = new Set<string>();
    for (const [i, sl] of (v.slices ?? []).entries()) {
      const key = `${sl.combo ?? ""}:${sl.size_id ?? ""}:${sl.country_id ?? ""}`;
      if (seenSlice.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slices", i, "no_of_items"],
          message: "This slice already has an override on the line",
        });
      }
      seenSlice.add(key);
    }

    const seen = new Set<string>();
    for (const [i, c] of (v.components ?? []).entries()) {
      const key = `${c.component_id}:${c.item_color_id ?? ""}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", i, "component_id"],
          message: "This panel is already on the line in that colour",
        });
      }
      seen.add(key);
    }
  });

export const mbaProcessInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  /**
   * The row's immutable anchor (0446) — what a Delivery Challan line points at.
   *
   * MUST BE ROUND-TRIPPED. `writeChildren` deletes and reinserts every process
   * row on save, so `id` and `sno` are both re-minted; this is the only thing
   * that survives, and a challan already raised against the row is matched by
   * it. Dropping it here would orphan a legally issued Rule 55 document.
   *
   * Optional in the schema and defaulted in the DB, so a payload from an older
   * client cannot fail to save — it produces a visibly un-dispatched row instead.
   */
  row_uid: uuidN.optional(),
  item_id: uuidN,
  process_id: uuidN,
  vendor_id: uuidN,
  qty_out: numN,
  qty_in: numN,
  status: z
    .enum(["planned", "sent", "part_received", "received"])
    .default("planned"),
  /* LEGACY'S FIVE (0465). `capsName` / `capsTextNullable` rather than plain
     `nullableText`: the transform belongs in the SCHEMA, because `lib/data-io`
     parses with these same schemas and writes straight to Postgres, so an
     action-level `.toUpperCase()` would miss any import path added later.
     AGENTS.md states this under CAPITALS. */
  stage: capsTextNullable(),
  for_scope: capsTextNullable(),
  description: capsTextNullable(),
  /** Bounded 0-100 and NULLABLE. NULL is "not asked"; 0 is "this process loses
   *  nothing" — different claims, and a default would assert the second. */
  loss_pct: z.coerce.number().min(0).max(100).nullable().default(null),
  notes: capsTextNullable(),
});

export const materialBomAmendmentInput = z.object({
  garment_order_id: uuidN,
  customer_id: uuidN,
  amend_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remarks: nullableText,
  // children
  items: z.array(mbaItemInput).default([]),
  processes: z.array(mbaProcessInput).default([]),
});
export type MaterialBomAmendmentInput = z.infer<typeof materialBomAmendmentInput>;
export type MbaItemInput = z.infer<typeof mbaItemInput>;
export type MbaProcessInput = z.infer<typeof mbaProcessInput>;

/** Draft vs Recorded — the DOCUMENT's own state, distinct from the ORDER-level
 *  question `status.ts` answers ("has this order been planned, and is the plan
 *  still current?"). Both are shown: this one inside the editor, that one on the
 *  two lists. */
export function mbaStatusTone(is_draft: boolean): "warning" | "success" {
  return is_draft ? "warning" : "success";
}
export function mbaStatusText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/** What the Copy sheet lists: an order whose BOM is worth copying from. */
export type BomCopySource = {
  bom_id: string;
  code: string | null;
  sc_no: string | null;
  customer_name: string | null;
  customer_id: string | null;
  amend_date: string;
  line_count: number;
};

/** The rows `copyMaterialBomFrom` hands back, shaped for the form. Quantities
 *  are absent by construction — they recompute against THIS order. */
export type BomCopyPayload = {
  items: Omit<MbaItemInput, "sno">[];
  processes: Omit<MbaProcessInput, "sno">[];
  /** True when the source order belongs to a different customer, so vendors
   *  were dropped. The sheet says so rather than leaving it to be noticed. */
  vendorsDropped: boolean;
};
