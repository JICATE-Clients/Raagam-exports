import { z } from "zod";
import { FABRIC_BASES } from "./requirement";
import { capsTextNullable } from "@/lib/validation/formats";
/* The route rows' own schema lives beside their narrowing rule, in
   `./processes.ts`, which is client-safe and is imported by the grid as well —
   see that file's header for why the rule is not in SQL. */
import { fabricBomProcessInput } from "./processes";
import { fabricBomYarnInput } from "./yarn-process";

// ============================================================================
// Orders ▸ Fabric BOM (0426). Step 3 of the client's order flow: which fabric,
// in which colour, for which panel, and how much.
//
// Header + two children — the fabric lines, and the STORED requirement those
// lines explode into. The requirement is not typed and not projected; it is
// computed by `./requirement.ts` on save. 0426's header argues at length for
// storing it, and its argument is 0418's.
//
// KEYED TO `garment_order_amendments`, like Material BOM and for the same
// reason: the production target this multiplies — order qty + excess + approval
// + projection — lives on the garment order's Approval Qty tab, and the
// `sales_orders` shell it would otherwise be read from has `order_qty` 0.
//
// NO STATUS FIELD BEYOND `is_draft`. The client is explicit in doc/prd.md: "BOM
// required no approval… After BOM, budgeting is done using Fabric BOM and
// Material BOM… This budget is approved." Approval is step 6's transition on the
// BUDGET. Draft vs Recorded is this document's own state and is a different
// question from the ORDER-level one `lib/orders/bom-status.ts` answers.
// ============================================================================

/**
 * Main fabric or trims fabric — the order's own `fabric_type` vocabulary (0408).
 *
 * LOWERCASE, matching the column's CHECK. The values are shared with
 * `garment_order_amendment_combo_structures`, so a seeded line carries the
 * order's word through unchanged rather than being re-spelled on the way — the
 * supply-type case split ('Nominated' vs 'nominated') is what that costs when it
 * goes wrong (AGENTS.md, Nominated vendors).
 */
export const FABRIC_TYPE_OPTIONS = [
  { value: "main", label: "Main fabric" },
  { value: "trims_fabric", label: "Trims fabric" },
] as const;

export interface FabricBomLine {
  id: string;
  bom_id: string;
  sno: number;
  /** Which style this fabric is for; NULL = every style. By VALUE (0407). */
  style_ref_no: string | null;
  /** The colourway; NULL = every combo on the order. By VALUE (0397). */
  combo: string | null;
  /** The fabric structure — SINGLE JERSEY, 1X1 LYCRA RIB. A `categories` row,
   *  which is where 0409 moved the order's own structure column. */
  structure_id: string | null;
  /** The panel's coordinate — PIECES / TOP / BOTTOM, an `items` row of class GAR
   *  (0396 · 0495). Carried WITH `component_id` because the Style declares the
   *  pair; the component alone does not identify a panel. */
  coordinate_id: string | null;
  /** Which panel this fabric is cut for. The `components` MASTER (0228), never
   *  `garment_style_components`, whose ids are rewritten on every save (0421). */
  component_id: string | null;
  /** The fabric itself — an `items` row of item class FABRIC. */
  item_id: string | null;
  fabric_type: string | null;
  /** Legacy Components ▸ "Required Color". `combo` is the ASSORT colour; this is
   *  the colour this panel is required in within it (0408's wording: "the front
   *  body, in the WHITE combo, is single jersey, in white"). */
  color_name: string | null;
  /** Legacy Components ▸ "Type" — 'open' | 'tubular' (0495). How the roll
   *  reaches cutting, not how the cloth is knitted (`FabricBomDia.knit_type`). */
  fabric_form: string | null;
  /** Legacy Components ▸ "Required Print" — text, matching the order's own
   *  `prints.print_name`, which 0477 made manual entry (0495). */
  required_print: string | null;
  /** Legacy Components ▸ "Specification" (0495). */
  specification: string | null;
  /** Yarn-dyed only (0513 · 0514) — the UOM its stripe repeat ratio is in,
   *  % or CM from the UOM MASTER. A different question from
   *  `consumption_uom_id` below, which is the unit the consumption FIGURE is in;
   *  0514's header lists the four readings this cell has had. */
  mixing_uom_id: string | null;
  /** Yarn-dyed only (0513) — distinct yarn colours knit into the pattern. */
  no_of_colors: number | null;
  /** Fabric per garment, in `consumption_uom_id`. */
  consumption: number | null;
  consumption_uom_id: string | null;
  /** The CUTTING room's buffer. NOT process loss — that is step 4, and applying
   *  it here as well charges the same loss twice (0426). */
  wastage_pct: number | null;
  /** 'colour' | 'colour_size'. */
  requirement_basis: string | null;
  /** Knitting diameter. Descriptive — step 4 plans knitting per diameter. */
  dia: number | null;
  required_by: string | null;
  rate: number | null;
  notes: string | null;
}

/**
 * One Fabric BOM ▸ Manual ENTRY (0494) — the tab's counting unit.
 *
 * A fabric structure, a SET of components, and a gram weight per size. The
 * client's own example is three of them: Single Jersey / Front + Back / 180 g,
 * Single Jersey / Sleeve / 20 g, Rib / Neck / 50 g.
 *
 * THE REQUIREMENT IS COMPUTED PER ENTRY, and `order_fabric_bom_lines` computes
 * none. That is what makes a grouped 180 g multiply once rather than once per
 * component — see 0494's header, and `takenComponentIds` in ./manual.ts for the
 * rule that keeps the entries a partition.
 */
export interface FabricBomManualEntry {
  id: string;
  bom_id: string;
  sno: number;
  /** Which style this weight is for; NULL = every style on the order (0495).
   *  BY VALUE, like every style reference in orders. */
  style_ref_no: string | null;
  /** 'open_width' | 'tubular' — the physical state of the cloth. A property of
   *  the entry, not of a size. */
  width_form: string | null;
  /**
   * THE CLOTH THIS WEIGHT IS FOR — `items.id`, and the entry's key since 0522.
   *
   * Legacy's Manual row leads with a Fabric column and carries no Structure
   * column (client 2026-09-03, screenshots 2666 · 2667). Everything the row
   * shows beside it — the knit type, the GSM, the measurement unit — is read
   * off this cloth rather than typed.
   */
  item_id: string | null;
  /** A `categories` row — the same vocabulary `order_fabric_bom_lines.structure_id`
   *  and the order's own combo structures use. DERIVED SINCE 0522: the save
   *  writes it as `item_id`'s `items.category_id`, because the requirement
   *  engine keys the order's GSM by a structure. Never offered as a field. */
  structure_id: string | null;
  /** 'direct' | 'calculated'. See `calcModeOf` in ./manual.ts. */
  calc_mode: string;
  /** The planned loss allowance — legacy's "Component Proc. Loss %".
   *  Net x (1 + this/100) = Gross. NOT the knitting or dyeing losses, which are
   *  step 4's (0427). */
  wastage_pct: number | null;
  /** Legacy's "EndBit Loss %" on the same row (0522) — a second allowance,
   *  beside `wastage_pct` rather than replacing it. */
  endbit_loss_pct: number | null;
  /** Legacy's "Assort Color wise" checkbox on the same row (0522). */
  assort_color_wise: boolean;
  /** Legacy's "Size Wise" toggle (0523) — TRUE gives every size its own row. */
  size_wise: boolean;
  components: FabricBomManualComponent[];
  sizes: FabricBomManualSize[];
}

/** One panel an entry's weight covers. The `components` MASTER (0228). */
export interface FabricBomManualComponent {
  id: string;
  entry_id: string;
  component_id: string;
}

/**
 * One size of one entry.
 *
 * `grams` IS STORED IN BOTH MODES — typed in direct, derived in calculated — so
 * no downstream reader has to know which produced it. `table_width` /
 * `length_tolerance` / `length` are the calculated mode's INPUTS, not second
 * answers; `cons_qty` is typed in both.
 */
export interface FabricBomManualSize {
  id: string;
  entry_id: string;
  sno: number;
  size_id: string | null;
  /** The fabric ROLL diameter this size is knitted at — a constraint, picked
   *  from the dias the BOM declares (0490). NOT what the weight multiplies. */
  dia: number | null;
  /** The commercial width the cloth is purchased at. */
  purchase_width: number | null;
  /** Fabric weight in GRAMS for one garment of this size. */
  grams: number | null;
  /** The PANEL width as laid on the cutting table — what the calculated weight
   *  multiplies. Renamed from `width` by 0495; see that migration for why the
   *  two words could not both be "width". */
  table_width: number | null;
  length: number | null;
  /** The cutting allowance ADDED TO THE LENGTH (0524). It was briefly
   *  `width_tolerance`, applied to the width, for a few hours on 2026-09-03
   *  (0523) — see `effectiveLength`. */
  length_tolerance: number | null;
  /** "Cons Qty" — units of cloth per garment (0523). NULL means 1; read it
   *  through `consQtyOf`, never with `?? 0`. */
  cons_qty: number | null;
}

/**
 * Circular / Flat / Woven — the "Type" beside a Dia / Size / Width (0490).
 *
 * THE CODES ARE `config_lookups` kind `fabric_structure`'s OWN, verbatim, so a
 * value stored here can be handed to `isCircularKnit()` in
 * `lib/orders/amendments/combo-rules.ts` with no translation step. The LABELS
 * are what the legacy panel prints (client screenshot 2577).
 *
 * NOT A PICKER OVER THAT LOOKUP, and the migration says why: three fixed
 * answers, and an FK would let a deleted lookup row take a stored dia with it.
 * Same trade `FABRIC_TYPE_OPTIONS` above already makes.
 */
export const KNIT_TYPE_OPTIONS = [
  { value: "circular", label: "Circular" },
  { value: "flat_knit", label: "Flat" },
  { value: "woven", label: "Woven" },
] as const;

/** One row of Color/Print Details ▸ Dia / Size Width Details (0490). */
export interface FabricBomDia {
  id: string;
  bom_id: string;
  sno: number;
  /** 'circular' | 'flat_knit' | 'woven'. */
  knit_type: string | null;
  /** Diameter for a circular knit, width for a flat knit or a woven. */
  dia: number | null;
}

/**
 * One row of Fabric BOM ▸ Yarn Process — the PARENT (0493 · 0504).
 *
 * DERIVED, NOT TYPED, and that is what makes this row unlike every other child
 * of this document. It exists because a fabric on the BOM declares this yarn in
 * `material_mixings` — the structured form of the legacy "bracket rule" — so
 * `item_id` is NOT NULL and is the row's identity. The planner cannot add one;
 * what they fill in are the STAGES beneath it.
 *
 * `purchase_qty` IS WRITTEN BY THE SERVER, never by the form, exactly like
 * `FabricBomRequirement` below. It is the figure the Budget pulls as a Yarn
 * Purchase line, so a client that could post it could post any purchase weight.
 */
export interface FabricBomYarn {
  id: string;
  bom_id: string;
  sno: number;
  /** The yarn — an `items` row. NOT NULL: the row is derived from a composition
   *  that names it. */
  item_id: string;
  /** The yarn's TOTAL across every colourway — each combo's net grossed by the
   *  sequential product of the stages treating it. */
  purchase_qty: number | null;
  uom_id: string | null;
  /** NULL `purchase_qty` means REFUSED, never "none needed" — this says which
   *  case. Most often a fabric whose several yarns declare no blend
   *  percentages, where any split would be invented. */
  refusal_reason: string | null;
  /** The processes, in order. Embedded by `listFabricBoms`; absent on a query
   *  that does not ask for them, exactly like `FabricBomLine.sizes`. */
  stages?: FabricBomYarnStage[];
}

/**
 * One process one yarn runs — the child grid (0504 · 0520).
 *
 * NO `bom_id`: a grandchild, reached only through its yarn, which is 0491's
 * shape for a line's sizes and for its reason.
 *
 * `process_qty` IS WHAT THIS STEP HANDLES — the yarn's whole purchase weight
 * since 0520. It was the weight of the colourways the step treated, until the
 * `For` column stopped naming one. The Budget pulls it as a Yarn Process line,
 * and a step naming no process produces neither a figure nor a line.
 */
export interface FabricBomYarnStage {
  id: string;
  yarn_id: string;
  /** The `No` column — the order the treatments happen in. */
  sno: number;
  /** `config_lookups` kind `yarn_stage` — GREY, DYED. */
  stage_id: string | null;
  /** A `processes` master row (0227), narrowed by `for_yarn` on the client. */
  process_id: string | null;
  /** The `For` column — `config_lookups` kind `process_loss_for`, PROCESS WISE
   *  or COLOR WISE, the same list the fabric route's `Loss for` reads. It named
   *  a COLOURWAY and divided the weight until 2026-09-03; see 0520. */
  loss_for_id: string | null;
  description: string | null;
  loss_pct: number | null;
  process_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
}

/** One stored requirement row. Written by the server, never by the form. */
export interface FabricBomRequirement {
  id: string;
  bom_id: string;
  /** Exactly one of `line_id` / `entry_id` is set (`chk_ofbr_one_parent`, 0494).
   *  Nothing writes `line_id` today — entries are the counting unit. */
  line_id: string | null;
  entry_id: string | null;
  item_id: string | null;
  sno: number;
  basis: string;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  slice_label: string;
  basis_qty: number;
  consumption: number;
  wastage_pct: number;
  /** NULL means REFUSED — never "none needed". `refusal_reason` says which case. */
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
}

/** The order a fabric BOM plans for, as much of it as the list and editor need. */
export type FabricBomOrder = {
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

export interface FabricBom {
  id: string;
  code: string | null;
  garment_order_id: string;
  bom_date: string;
  is_draft: boolean;
  remark: string | null;
  computed_at: string | null;
  computed_for_qty: number | null;
  computed_basis_hash: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  garment_order?: FabricBomOrder | null;
  lines: FabricBomLine[];
  requirements: FabricBomRequirement[];
  dias: FabricBomDia[];
  processes: FabricBomProcess[];
  /** Yarn Process (0493 · 0504) — one row per yarn the BOM's fabrics are made
   *  of, each carrying its treatments and its computed purchase weight. */
  yarns: FabricBomYarn[];
  /** Manual (0494) — the weight entries, and THE COUNTING UNIT of the document.
   *  A sibling of `lines` rather than a child of one: an entry groups several
   *  components at one combined weight. */
  manualEntries: FabricBomManualEntry[];
  /** [Detail] ▸ Yarn Dyed Details (0512) — the two TYPED panels. Mixing Details
   *  is derived from `ydRepeats` and is deliberately not stored; see
   *  `mixingDetailRows` in yarn-dyed.ts. */
  ydRepeats: FabricBomYdRepeat[];
  ydCombinations: FabricBomYdCombination[];
}

/**
 * One yarn colour repeat — [Detail] ▸ Yarn Dyed Details ▸ Repeats (0512).
 *
 * ADDRESSED BY THE FABRIC GROUP, HELD BY VALUE (`style_ref_no · structure_id ·
 * item_id`), never by `line_id`: the overlay is opened for a group of N
 * colourway lines, and `updateFabricBom` deletes every line by `bom_id` and
 * re-inserts, so a cascade off a line would make an ordinary Save destroy these.
 */
export interface FabricBomYdRepeat {
  id: string;
  style_ref_no: string | null;
  structure_id: string | null;
  item_id: string | null;
  sno: number;
  yarn_item_id: string | null;
  dye_type: "dyed" | "grey";
  color_name: string | null;
  uom_id: string | null;
  value: number | null;
  twisted_yarn: string | null;
}

/** One yarn-dyed combination — same addressing as `FabricBomYdRepeat`. */
export interface FabricBomYdCombination {
  id: string;
  style_ref_no: string | null;
  structure_id: string | null;
  item_id: string | null;
  combo: string | null;
  yd_combo_name: string | null;
}

/**
 * One step of one fabric's route — Fabric BOM ▸ Fabric Process (0492).
 *
 * A FOURTH CHILD OF THE HEADER, flat, keyed to the FABRIC rather than to a BOM
 * line — a rib collar and a rib cuff are two lines and one route (0492).
 * `listFabricBoms` reads every child in one PostgREST select and `writeLines`
 * clears each with one `delete().eq("bom_id", …)`, exactly as for `_dias`.
 *
 * `loss_pct` IS DECLARATIVE. It is not read by `./requirement.ts` and does not
 * change Calculated Quantities — 0426 reserves process loss for step 4, whose
 * `order_fabric_plan_stages` (0427) is what plans against this.
 */
export interface FabricBomProcess {
  id: string;
  bom_id: string;
  /** The FABRIC this route belongs to — one route per fabric per BOM, however
   *  many lines name it. An `items` row, never a BOM line (0492). */
  item_id: string;
  sno: number;
  /** `config_lookups` kind 'fabric_stage' — GREY, DYED. */
  stage_id: string | null;
  process_id: string | null;
  /** `config_lookups` kind 'process_loss_for' — "Process wise". */
  loss_for_id: string | null;
  description: string | null;
  loss_pct: number | null;
  /* NO `rate`. It held the fabric-wise processing rate and the client removed
     the column on 2026-09-03 (0521). The route is a quantity document; a price
     is entered once, on the Budget. Do not confuse this with
     `FabricBomLine.rate` above, which is a different figure on a different row
     and is untouched. */
  /** `config_lookups` kind 'fabric_process_type' — deliberately unseeded. */
  type_id: string | null;
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

/**
 * One size row of a Manual entry (0494).
 *
 * EVERY FIELD OPTIONAL, for `fabricBomDiaInput`'s reason and one sharper one:
 * these rows are not typed into existence at all — the screen derives them from
 * the order's own sizes, so a row exists the moment a size does and stays blank
 * until the planner reaches it. Refusing a half-filled row here would make an
 * untouched entry block Save the moment the order gained a size.
 *
 * `normalizeManualSizes` in actions.ts decides what is worth STORING — the same
 * division between "is this valid" and "does this say anything" that
 * `fabricBomLineInput` and `fabricBomDiaInput` both draw.
 */
export const fabricBomManualSizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  size_id: uuidN,
  dia: numN,
  purchase_width: numN,
  /** GRAMS per garment. Stored in both modes — see `gramsFor` in ./manual.ts. */
  grams: numN,
  table_width: numN,
  length: numN,
  /* THE ALLOWANCE IS ON THE LENGTH (0524, reverting 0523's few hours on the
     width) — `effectiveLength` in ./manual.ts records why. */
  length_tolerance: numN,
  /* "Cons Qty" — units of cloth per garment. NULLABLE and NULL MEANS 1: a
     column default would make an untouched row indistinguishable from a
     deliberate 1. `consQtyOf` is the one place that reading lives. */
  cons_qty: numN,
});

/**
 * One Manual entry (0494) — the tab's counting unit.
 *
 * NO `superRefine` HERE, unlike `fabricBomLineInput` below, and the asymmetry is
 * deliberate. That schema can decide a line's completeness from the line alone.
 * An entry's cannot: whether every size is answered depends on which sizes the
 * ORDER states, which is not in this object and cannot be — `manualProblem` in
 * ./manual.ts is the rule, and it is read by the screen's Save gate, the
 * overlay's Done button and the server action alike. Restating half of it here
 * would be a second, weaker opinion that a `lib/data-io` import could satisfy
 * while still being wrong.
 *
 * `components` IS A LIST OF ids, not of rows. The join table is an
 * implementation of "a set of components"; the form holds the set.
 */
export const fabricBomManualEntryInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  /* NULLABLE TEXT, and null is a VALUE — "every style on this order" (0495).
     Not `.min(1)`: an unscoped entry is the ordinary case on a single-style
     order and is what every entry stored before 0495 already means. */
  style_ref_no: nullableText,
  width_form: z.enum(["open_width", "tubular"]).nullable().default(null),
  /* THE CLOTH, NAMED DIRECTLY (0522) — legacy's Manual row leads with a Fabric
     column and carries no Structure column at all (client 2026-09-03,
     screenshots 2666 · 2667). Optional here and demanded by `manualProblem`:
     a draft entry that has not chosen yet is a real state, and refusing it in
     the schema would make a half-filled row unsaveable as a DRAFT. */
  item_id: uuidN,
  /* DERIVED FROM `item_id` AND STILL WRITTEN — the action sets it to the
     fabric's `items.category_id` (0405 · 0415 · 0426: a Structure on this screen
     IS a fabric category), because the requirement engine keys its GSM lookup on
     a structure. Accepted here so an import can round-trip a stored row; it is
     overwritten from the fabric whenever one is named, so a disagreeing value
     cannot survive a save. */
  structure_id: uuidN,
  calc_mode: z.enum(["direct", "calculated"]).default("direct"),
  wastage_pct: z.coerce.number().min(0).max(100).nullable().default(0),
  /* Legacy's "EndBit Loss %", beside the process loss above rather than
     replacing it: the fabric row carries BOTH allowances (0522). */
  endbit_loss_pct: z.coerce.number().min(0).max(100).nullable().default(0),
  /* Legacy's "Assort Color wise" checkbox on the same row (0522). */
  assort_color_wise: z.coerce.boolean().default(false),
  /* Legacy's "Size Wise" toggle (0523). TRUE — the default and the existing
     behaviour — gives every size its own row; FALSE lets the planner type one
     figure that the screen writes to every size, so it changes what is ASKED
     and never what is stored. */
  size_wise: z.coerce.boolean().default(true),
  component_ids: z.array(z.string().uuid()).default([]),
  sizes: z.array(fabricBomManualSizeInput).default([]),
});

export const fabricBomLineInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    style_ref_no: nullableText,
    combo: capsTextNullable(),
    structure_id: uuidN,
    /* THE PANEL AND THE COORDINATE IT BELONGS TO (0495). Carried as a PAIR:
       the Style master declares FRONT BODY *of* PIECES, so the component alone
       does not identify a panel and a line holding one without the other cannot
       say which of two identically-named parts it means. */
    coordinate_id: uuidN,
    component_id: uuidN,
    item_id: uuidN,
    fabric_type: nullableText,
    // CAPS in the SCHEMA, not the action: `lib/data-io` parses imports with this
    // same schema and writes straight to Postgres, so an action-level
    // `.toUpperCase()` misses every spreadsheet import (AGENTS.md, "CAPITALS").
    color_name: capsTextNullable(),
    /* Legacy Components ▸ "Type" — open | tubular (0495). The enum, not free
       text, so a value the CHECK would reject is refused here first, in words,
       rather than as a constraint violation at insert. */
    fabric_form: z.enum(["open", "tubular"]).nullable().default(null),
    /* Legacy Components ▸ "Required Print" (0495). TEXT because 0477 made the
       order's prints manual entry — there is no id to point at. CAPS in the
       SCHEMA for the reason stated on `color_name` above. */
    required_print: capsTextNullable(),
    /* Legacy Components ▸ "Specification" (0495). */
    specification: capsTextNullable(),
    consumption: numN,
    /* THE TWO YARN-DYED CELLS (0513). Optional HERE and conditionally required
       in `missingFabricLineFields` — the type that decides them lives on
       `items.fabric_type_id`, which this schema cannot reach from `item_id`.
       AGENTS.md states that division; the migration header states it again. */
    mixing_uom_id: uuidN,
    no_of_colors: z.coerce.number().int().min(1).max(99).nullable().default(null),
    consumption_uom_id: uuidN,
    wastage_pct: z.coerce.number().min(0).max(100).nullable().default(0),
    requirement_basis: z.enum(FABRIC_BASES).nullable().default(null),
    dia: numN,
    required_by: nullableText,
    rate: numN,
    notes: capsTextNullable(),
  })
  /**
   * THE LINE RULES LIVE IN THE SCHEMA, NOT IN THE ACTION.
   *
   * `lib/data-io` parses imports with these same `*Input` schemas and writes
   * straight to Postgres, so a rule enforced only in the server action misses
   * every spreadsheet import — the identical argument AGENTS.md makes for
   * putting the CAPITALS transform in Zod rather than in the action.
   *
   * Gated on a fabric being NAMED. An entirely blank row is how a grid opens
   * (the `seedRow` rule) and is dropped before it reaches the database;
   * refusing it here would make an untouched blank line block Save.
   *
   * The messages are the ENGINE'S, word for word. `requirement.ts` prints them
   * in the Calculated Quantities section as it recomputes, and this prints them
   * under the offending cell — two spellings of one refusal is how an operator
   * comes to believe there are two different problems.
   */
  .superRefine((v, ctx) => {
    if (!v.item_id) return;

    /* NO CONSUMPTION RULE ANY MORE (0494), and its absence is deliberate rather
       than an oversight of this schema's own history.

       This refused a line with a fabric and no consumption for as long as the
       LINE was what exploded. Entries are the counting unit now, so a fully
       answered BOM legitimately has lines carrying no consumption at all — and
       leaving the rule here would have made such a document unsaveable, through
       Zod, on a screen with nothing to say why. `lib/data-io` parses with this
       schema too, so the block would have reached an import as well.

       WHAT REPLACES IT IS `manualProblem`, on the entry. The requirement is
       refused there, by name, in the engine's own words. */
    if (!v.consumption_uom_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consumption_uom_id"],
        message: "Choose the unit this consumption is in",
      });
    }
    /* OPEN OR TUBULAR IS MANDATORY (client 2026-09-01: "a specific, mandatory
       field on this tab"), and this is where the mandate becomes real.

       IT IS DECLARED ONCE AND ENFORCED FOUR TIMES — the star on the control, the
       cursor hold, the Save gate and this. AGENTS.md's "one declaration, four
       enforcers" is the rule; [[raagam-stated-vs-enforced]] is what happens
       without the fourth: "a rule written into a `*Problems()` function with no
       star, no hold and no Save gate is invisible, and the client reports it as
       not done and is right."

       GATED ON `item_id` LIKE ITS NEIGHBOUR, so a blank row the grid opened does
       not block Save, and `lib/data-io` gets the same refusal an operator does. */
    if (!v.fabric_form) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fabric_form"],
        message: "Choose Open or Tubular",
      });
    }
    /* AND NO SPLIT RULE, for the same reason (0494). `requirementRows` hardcodes
       `colour_size` — grams are stated per size, and fabric is dyed per
       colourway — so `requirement_basis` is no longer consulted by anything that
       computes. The COLUMN stays: it is 0426's, it still describes the line, and
       dropping it would be destructive for a change that is about arithmetic.

       `consumption_uom_id` ABOVE IS NOT IN THIS GROUP. `entryFabric` resolves
       the requirement's unit off the lines sharing the entry's structure, so it
       is written into every stored row — it is the one of the four cells 0494
       did not void, and the only one that may still refuse. */
  });

/**
 * One Dia / Size / Width row (0490).
 *
 * EVERY FIELD OPTIONAL, like every line cell in this module. A grid opens on a
 * blank row and an operator fills it left to right; refusing a half-filled row
 * here would block Save on a row nobody has finished. `diaFilled` in actions.ts
 * is what decides whether a row is worth STORING — the same division of labour
 * `fabricBomLineInput` above draws between "is this valid" and "does this say
 * anything".
 */
export const fabricBomDiaInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  knit_type: z.enum(["circular", "flat_knit", "woven"]).nullable().default(null),
  dia: numN,
});

/**
 * ONE YARN COLOUR REPEAT — [Detail] ▸ Yarn Dyed Details ▸ Repeats (0512).
 *
 * THE THREE ADDRESS FIELDS ARE THE ROW'S IDENTITY, not decoration. The overlay
 * is opened for a fabric GROUP (`fabricGroupKey` = style · structure · item),
 * and `updateFabricBom` deletes every LINE by `bom_id` and re-inserts — so a
 * repeat keyed to a line id would be destroyed by an ordinary Save from the
 * Fabric Lines grid. 0512's header states this at length; it is the same call
 * `dias` already makes.
 *
 * EVERY VALUE FIELD OPTIONAL, for `fabricBomDiaInput`'s reason: a grid opens on
 * a blank row and is filled left to right, so refusing a half-filled row here
 * blocks Save on a row nobody has finished. `ydRepeatFilled` in actions.ts is
 * what decides whether a row is worth STORING.
 *
 * `dye_type` DEFAULTS TO `dyed` BECAUSE THAT IS WHAT THE PANEL IS FOR. `grey`
 * is the undyed remainder and is excluded from Mixing Details entirely — see
 * `mixingDetailRows` in yarn-dyed.ts.
 */
export const fabricBomYdRepeatInput = z.object({
  style_ref_no: nullableText,
  structure_id: uuidN,
  item_id: uuidN,
  sno: z.coerce.number().int().nonnegative().default(0),
  yarn_item_id: uuidN,
  dye_type: z.enum(["dyed", "grey"]).default("dyed"),
  /* CAPSED IN THE SCHEMA, like `color_name` on the line — never only in the
     action, or `lib/data-io` writes a lower-cased colour straight to Postgres. */
  color_name: capsTextNullable(),
  uom_id: uuidN,
  value: numN,
  twisted_yarn: capsTextNullable(),
});

/**
 * ONE YARN-DYED COMBINATION — [Detail] ▸ Yarn Dyed Details ▸ Combinations.
 *
 * Addressed exactly as a repeat is, and for the same reasons. `combo` is held
 * BY NAME because that is how this whole document keys a colourway (0426).
 */
export const fabricBomYdCombinationInput = z.object({
  style_ref_no: nullableText,
  structure_id: uuidN,
  item_id: uuidN,
  combo: capsTextNullable(),
  yd_combo_name: capsTextNullable(),
});

/**
 * One palette name as the payload carries it — trimmed and upper-cased, and
 * allowed to be empty. See the `palette` key below for why it is not `capsName`.
 */
const paletteName = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase());

export const fabricBomInput = z.object({
  /**
   * MANDATORY, and it is the only header field that is.
   *
   * Everything this document computes is a multiple of the order's production
   * target, so a BOM with no order is not an incomplete record — it is a
   * document with no arithmetic. `uuidN` elsewhere in this file means "not
   * chosen yet"; here it would mean "cannot mean anything".
   */
  garment_order_id: z.string().uuid({ message: "Choose the garment order" }),
  bom_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: nullableText,
  lines: z.array(fabricBomLineInput).default([]),
  dias: z.array(fabricBomDiaInput).default([]),
  /** [Detail] ▸ Yarn Dyed Details ▸ Repeats (0512). Plain siblings of `dias`,
   *  addressed by the fabric group they belong to rather than by a line. */
  yd_repeats: z.array(fabricBomYdRepeatInput).default([]),
  /** [Detail] ▸ Yarn Dyed Details ▸ Combinations (0512). */
  yd_combinations: z.array(fabricBomYdCombinationInput).default([]),
  /**
   * Fabric Process ▸ one route per FABRIC (0492).
   *
   * A PLAIN SIBLING OF `dias`, which it was not for two drafts. Keyed on a BOM
   * line these rows could not be sent at all (line ids are minted by the save),
   * so they were first keyed by `line_sno` and then nested inside `lines`.
   * Re-keying to `item_id` — a stable master id — removed the reason for both.
   * See `fabricBomProcessInput` for the full history; it is kept because each
   * shape was correct under the constraint it was written for.
   */
  processes: z.array(fabricBomProcessInput).default([]),
  /**
   * Yarn Process ▸ one row per yarn the fabrics are made of (0493).
   *
   * DERIVED ROWS, so this array is not "what the operator typed" but "what the
   * fabrics imply, with the operator's answers attached". The screen re-derives
   * it on every render from `material_mixings` and re-attaches the answers by
   * `item_id`; the action recomputes each row's purchase weight from the same
   * requirement it stores for the fabric lines.
   *
   * NO `purchase_qty` IN THE PAYLOAD — see `fabricBomYarnInput`. The figure a
   * yarn purchase is raised against is the server's to compute.
   */
  yarns: z.array(fabricBomYarnInput).default([]),
  /**
   * Manual ▸ the weight entries, and THE COUNTING UNIT of the document (0494).
   *
   * A TOP-LEVEL CHILD and not a child of `lines`, for the reason 0494's header
   * gives: an entry groups several components at one combined weight, so it
   * cannot hang off any single line without inventing a split between them. Its
   * own components and sizes travel INSIDE it, which is the same rule the yarn
   * route above states — the parent's id does not exist until its insert has
   * run.
   */
  manualEntries: z.array(fabricBomManualEntryInput).default([]),
  /**
   * Color/Print Details ▸ the ORDER's palette, editable from this screen
   * (client 2026-09-02).
   *
   * ## IT IS NOT A CHILD OF THIS DOCUMENT AND MUST NOT LOOK LIKE ONE
   *
   * Every other key on this object writes an `order_fabric_bom_*` row. This one
   * writes `garment_order_amendment_dyeings` / `_prints` — the ORDER's tables —
   * because the three panels show the order's palette and 0490's one-list design
   * is kept; what changed is only who may write to it. See `./palette.ts`.
   *
   * ## A SET OF NAMES, NOT A SET OF ROWS
   *
   * A dyeing row carries `dye_type` and `color_id` that this tab never displays,
   * so the payload deliberately cannot express them: sending rows would let a
   * screen that shows one column overwrite three. `paletteDiff` turns these
   * names into inserts and deletes, and every surviving row is left untouched.
   *
   * OPTIONAL, so a caller that does not touch the tab sends nothing and the
   * palette is left exactly as it is. `undefined` means "not my business";
   * an empty array means "the operator emptied this panel", and those are
   * different instructions — `.default([])` here would make every save that
   * omits the key try to delete the order's whole palette.
   */
  palette: z
    .object({
      /* CAPS IN THE SCHEMA, which is where AGENTS.md puts the transform — an
         action-level `.toUpperCase()` misses every writer that is not the
         action. NOT `capsName()`, though: its `.min(1)` would reject the blank
         row a ChildGrid opens on and fail the whole save on an empty panel.
         `paletteDiff` is what drops blanks, and it must be handed them. */
      fabric: z.array(paletteName).default([]),
      yarn: z.array(paletteName).default([]),
      prints: z.array(paletteName).default([]),
    })
    .optional(),
});

/**
 * WHAT A CALLER PASSES, as opposed to what the schema hands back.
 *
 * `z.infer` is the OUTPUT type: every `.default()` has been resolved, so every
 * key reads as required. That is right for the normalise/write helpers, which
 * only ever see `p.data` — and wrong for the two action signatures, which is
 * where a caller stands. A form that legitimately declares no `dia` and no
 * `rate` (the Fabric Lines grid stopped carrying either on 2026-09-01, client
 * screenshot 2581) then fails to typecheck against a schema that defaults both.
 *
 * SPLIT RATHER THAN LOOSENED. `FabricBomInput` still means the parsed value, so
 * nothing inside `actions.ts` starts having to re-test for a key the parse has
 * already supplied.
 */
export type FabricBomFormInput = z.input<typeof fabricBomInput>;

export type FabricBomInput = z.infer<typeof fabricBomInput>;
export type FabricBomLineInput = z.infer<typeof fabricBomLineInput>;
export type FabricBomManualEntryInput = z.infer<typeof fabricBomManualEntryInput>;
export type FabricBomManualSizeInput = z.infer<typeof fabricBomManualSizeInput>;
export type FabricBomDiaInput = z.infer<typeof fabricBomDiaInput>;
export type FabricBomYdRepeatInput = z.infer<typeof fabricBomYdRepeatInput>;
export type FabricBomYdCombinationInput = z.infer<typeof fabricBomYdCombinationInput>;
/* Re-exported so a caller needing the payload type does not have to know that
   the route rules live in `./processes.ts` — the schema itself stays there,
   beside the narrowing the picker reads, so there is still one declaration. */
export type { FabricBomProcessInput } from "./processes";

/** Draft vs Recorded — the DOCUMENT's own state, distinct from the ORDER-level
 *  question `lib/orders/bom-status.ts` answers ("has this order been planned,
 *  and is the plan still current?"). Both are shown: this one inside the editor,
 *  that one on the work queue. */
export function fabricBomStatusTone(is_draft: boolean): "warning" | "success" {
  return is_draft ? "warning" : "success";
}
export function fabricBomStatusText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/**
 * One row of the order's combo tree, flattened — what the Seed button offers.
 *
 * FLATTENED BY THE SERVICE, not by the screen. The tree is three levels deep
 * (combo -> structure -> component) and the BOM is one line per leaf, so the
 * flattening is the seed rule itself; leaving it on the screen would put it
 * beside the grid state where the next screen to want it would rewrite it.
 */
export type OrderFabricSeedRow = {
  style_ref_no: string | null;
  /** Style No and Article No — the order's own identity for this style, shown
   *  READ-ONLY in the editor header (client spec, 2026-09-01: "auto-populate
   *  based on the selected RE Number. No manual entry is permitted"). They ride
   *  on the seed row because that is already the one query that walks the
   *  order's combo tree; `confirmedOrdersForBom()` is shared with Material BOM
   *  and did not need widening for one screen's header. */
  style: string | null;
  article_no: string | null;
  combo: string | null;
  structure_id: string | null;
  structure_name: string | null;
  /** The panel's coordinate, carried WITH the component (0495) — the Style
   *  declares the pair, and a seeded line missing it shows a blank Coordinate
   *  cell on the Components sheet. */
  coordinate_id: string | null;
  component_id: string | null;
  component_name: string | null;
  fabric_type: string | null;
  color_name: string | null;
  /**
   * THE PART'S "ROLL FORM PRINT" AS A NAME (client 2026-09-02, screenshot 2637).
   *
   * `garment_order_amendment_combo_components.print_id` — the last cell of the
   * Structure Details parts grid — resolved here, and it lands on the seeded
   * line's `required_print`. The client chose that mapping over a column of its
   * own: Components already has a Required Print cell, and two cells carrying
   * one fact is how they come to disagree.
   *
   * A NAME AND NOT AN ID, because `required_print` is TEXT on the BOM line, fed
   * by a `<Combobox>` over the order's declared print palette. Resolving it here
   * is the same call `component_name` and `structure_name` already make, for
   * their reason: the screen holds the master lists, and a print the order names
   * that the master has since deactivated would resolve to nothing there.
   */
  print_name: string | null;
  /**
   * SOLID / MELANGE / YARN DYED, and the GSM band — legacy FabricAllocation's
   * own `Type` and `GSM Range` columns (client screenshot 2581, 2026-09-01).
   *
   * DESCRIPTIVE, NEVER COPIED TO THE LINE. The screen renders them as two
   * read-only cells by looking the line up in these rows; storing them on
   * `order_fabric_bom_lines` would be a second place for them to disagree with
   * the order, and the order is the one that is right.
   *
   * `gsm_tolerance` rides along because legacy prints a RANGE — `gsmRange()`
   * needs both halves to say "175 - 185", and `gsm` alone says "180".
   */
  item_sub_type: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
};

/**
 * What the ORDER declares that this BOM must cover — the three read-only panels
 * of Color/Print Details (0490). See `getOrderPalette` for why they are read
 * rather than stored.
 *
 * SHAPED AS THE THREE PANELS, not as one list with a discriminator, because
 * that is what the screen renders and the split is a fixed three rather than a
 * facet. `section` on the dyeing rows is kept anyway: it is what the service
 * split ON, and dropping it from the type would make the two arrays look
 * interchangeable to a reader who has not seen the query.
 */
export type OrderPaletteDye = {
  sno: number;
  section: string | null;
  dye_type: string | null;
  color_name: string | null;
};

export type OrderPalette = {
  yarn: OrderPaletteDye[];
  fabric: OrderPaletteDye[];
  prints: { sno: number; print_name: string | null }[];
};
