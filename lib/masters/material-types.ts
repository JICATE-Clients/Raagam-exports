import { z } from "zod";
import { nullableFormat, HSN_RE, capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Material — the rich master over `items` (0226). Header (Item Class + HSN) +
// UOM tab (common) + a Details tab that varies per Item Class. The 8 classes
// map to 3 Details layouts (A/B/C).
// ============================================================================

export interface MaterialMixing {
  id: string;
  item_id: string;
  sno: number;
  description: string | null;
  shade: string | null;
  uom_id: string | null;
  /** Links this blend row to an actual Yarn `items` record — client walkthrough:
   *  "we take the master-based cotton... we get the cardinal cotton" (0279). */
  component_item_id: string | null;
  count_id: string | null;
  blend_pct: number | null;
}
export interface MaterialUomConversion {
  id: string;
  item_id: string;
  sno: number;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
}
/** "Using (Items)" grid — General item class only (0304): which other items
 *  (any class) this material uses, plus Shade/UOM per line. */
export interface MaterialUsingItem {
  id: string;
  item_id: string;
  sno: number;
  used_item_id: string | null;
  description: string | null;
  shade: string | null;
  uom_id: string | null;
}

export interface Material {
  id: string;
  code: string; // Short Name
  name: string;
  is_active: boolean; // Inactive = !is_active
  item_class_id: string | null;
  hsn_code: string | null;
  hsn_id: string | null;
  category_id: string | null;
  /** Second classification level under the Category — General only (0349).
   *  e.g. Category ELECTRICAL ▸ Sub Category LIGHTS. Null when the category
   *  defines no sub-categories, which is the normal case for every other class. */
  sub_category_id: string | null;
  /** Legacy "Type" — for SEW/PACK it is the accessory Transaction Type
   *  (Purchased / Converted; Production filtered out in the form). General
   *  never asks for it and always stores "Purchased" (client 2026-07-28). */
  material_type: string | null;
  /** General item class only (0350) — the kind of thing (BRUSH, PEN, CABLE) and
   *  the specific item (NYLON 4 INCH). Free text; the third and fourth segments
   *  of the auto-composed Name. Null for every other class. */
  item_type_name: string | null;
  item_base_name: string | null;
  user_defined: boolean;
  specifications: string | null;
  short_spec: string | null;
  count_id: string | null;
  purity_id: string | null;
  shade: string | null;
  /** Fabric type — kind `fabric_type`, Fabric only. Solid · Yarn Dyed · Melange
   *  · Printed (0515), but READ THE LOOKUP: this list has grown twice and the
   *  "Grey" once named here was renamed to Solid by 0312. */
  fabric_type_id: string | null;
  /** Fabric "Type" in the legacy sense — Circular Knit/Flat Knit/Woven, kind
   *  `fabric_structure` — Fabric only. A direct field on the material; drives
   *  UOM auto-derivation on change (0301). Distinct from `category_id`, which
   *  on Fabric holds the legacy "Structure" (e.g. "1X1 FANCY RIB" — a specific
   *  knit/weave pattern, still labeled "Structure" in the Fabric Details UI). */
  fabric_structure_id: string | null;
  /** Fabric "Using" — Single Yarn / Multiple Yarn, free values (see
   *  `FABRIC_USING`). Fabric only, stored as-is (no behavior tied to it). */
  fabric_using: string | null;
  /** Yarn type (Grey/Melange/Twisted/Doubling, kind `yarn_type`) — Yarn only. */
  yarn_type_id: string | null;
  /** Fabric bought finished from a vendor — skips the yarn-composition
   *  requirement entirely (functional spec, 0280). Fabric only. */
  direct_purchase: boolean;
  /** This material is bought in a different unit than it is consumed in —
   *  thread consumed in metres but purchased in cones, buttons consumed in
   *  numbers but purchased in gross (0348). ~90% of materials are false, and
   *  for those the four slots below all equal `base_uom_id` and `conversions`
   *  is empty (the server enforces both). */
  has_alternate_uom: boolean;
  base_uom_id: string | null;
  stock_uom_id: string | null;
  billing_uom_id: string | null;
  planning_uom_id: string | null;
  purchase_uom_id: string | null;
  cost_head_id: string | null;
  budget_rate: number | null;
  budget_rate_uom_id: string | null;
  created_at: string;
  created_by: string | null;
  mixings: MaterialMixing[];
  conversions: MaterialUomConversion[];
  using_items: MaterialUsingItem[];
  item_attribute_values: { id: string; attribute_line_id: string | null; sno: number; value: string | null }[];
}

// ---------------------------------------------------------------------------
// Per-class Details form registry
// ---------------------------------------------------------------------------
export type DetailFieldKey =
  | "category_id"
  | "sub_category_id"
  | "item_type_name"
  | "item_base_name"
  | "material_type"
  | "specifications"
  | "short_spec"
  | "count_id"
  | "purity_id"
  | "shade";

// "Type" is a selection-only dropdown.
export const MATERIAL_TYPES = ["Production", "Purchased", "Converted"] as const;

// Fabric "Using" — legacy fixed-choice dropdown (0302).
export const FABRIC_USING = ["Single Yarn", "Multiple Yarn"] as const;

export type MaterialForm = { fields: DetailFieldKey[]; mixing: boolean };

/** A = Button/Capital/Sewing/Packing, GEN = General, C = Garments — all still
 *  generic, switch-rendered. Fabric and Yarn diverged too far (structure
 *  inheritance, nature-driven branching, %-mixing) for the generic switch — they
 *  get their own dedicated form components in the screen (0279). */
// Form A (Button/Capital/Sewing/Packing): Category + Transaction Type.
// Description/Short-Spec dropped from the UI (client 2026-07-25 — the item name
// comes from the attributes, not a free-text description); the
// specifications/short_spec DB columns are kept for round-trip. "User defined"
// was dropped on 2026-07-30 — see the note on form C below.
// `sub_category_id` sits right after the Category it hangs off. Only the classes
// in SUB_CATEGORY_CLASS_CODES (category-types.ts) show it, so the screen filters
// it out of this list rather than the registry carrying two variants of form A
// (see the fields.filter at the Classification section). It stays in A for the
// day Capital Goods joins that set — today only GEN below actually renders it.
// Form GEN (General) split out of A on 2026-07-28. A consumable is identified by
// Category ▸ Sub Category ▸ Item Type ▸ Item Name, and the Name is composed from
// exactly those four — nothing is typed by hand. The two fields A shows are noise
// here: the Transaction Type only ever has one answer, since a consumable is
// always bought (the screen sends "Purchased" silently). The column still
// round-trips; it is simply not asked for.
// Form C (Garments) is deliberately SHORTER than A. A garment is identified by
// its category and its name and nothing else — the client asked for "Category
// Name and Item Name", with none of the consumption/conversion modelling that
// sewing thread or buttons need, and no Transaction Type (client 2026-07-28).
// "USER DEFINED" IS GONE FROM ALL THREE FORMS (client 2026-07-30). It was a
// Yes/No asked on the Category and echoed read-only here to explain why the
// Attributes grid had appeared. The client's answer to "what does it do?" was to
// remove it. `categories.user_defined` and `items.user_defined` still exist and
// still round-trip; no row has ever been set to true, so nothing about the
// attribute flow changes — see the note at `attributeDriven` in
// material-master-screen.tsx.
export const MATERIAL_FORMS: Record<"A" | "GEN" | "C", MaterialForm> = {
  A: { fields: ["category_id", "sub_category_id", "material_type"], mixing: false },
  GEN: { fields: ["category_id", "sub_category_id", "item_type_name", "item_base_name"], mixing: false },
  C: { fields: ["category_id"], mixing: false },
};

export type MaterialFormKey = "A" | "FABRIC" | "YARN" | "GEN" | "C";

/** Map an item-class CODE to its Details form (unknown/new classes → A). */
export function itemClassForm(code: string | null | undefined): MaterialFormKey {
  switch ((code ?? "").toUpperCase()) {
    case "FABRIC":
      return "FABRIC";
    case "YARN":
      return "YARN";
    case "GEN":
      return "GEN";
    case "GAR":
      return "C";
    default:
      return "A";
  }
}

/**
 * The fields a material of this class MUST carry, by the class's own CODE
 * (client 2026-08-04). One declaration, three enforcers — the screen's `*`s and
 * the cursor hold, the Save button, and the create/update actions that
 * `lib/data-io` imports also reach.
 *
 * WHY THIS IS A FUNCTION AND NOT THE ZOD FIELD TYPES. Requiredness here is not a
 * property of a column, it is a property of a column *for a class*: Count is
 * mandatory on a Yarn and meaningless on a General. And `materialInput` only
 * ever sees `item_class_id`, a uuid — the class CODE that decides all of this is
 * a lookup away, so a `.superRefine()` on the schema could not answer it. The
 * action resolves the code (as `findDuplicateYarn` already does) and calls this.
 *
 * `purity_id` is deliberately absent from YARN: a yarn with no purity is a real
 * yarn, and `findDuplicateYarn` (0279) already treats a null purity as its own
 * identity rather than as a missing value. `hsn_code` and `shade` are absent
 * from every class for the same kind of reason — HSN is tax paperwork that
 * accounts fills in later, and Shade only exists on melange.
 *
 * `name` is NOT listed. On Yarn/Fabric/accessory classes it is composed from the
 * fields above and is `readOnly`, so requiring it would hold a field the
 * operator cannot type into — a cage with no keyboard way out. Filling the
 * sources is what writes it, which is why requiring the sources is enough.
 */
const REQUIRED_BY_FORM: Record<MaterialFormKey, readonly (keyof MaterialInput)[]> = {
  YARN: ["item_class_id", "yarn_type_id", "count_id", "category_id", "base_uom_id"],
  FABRIC: ["item_class_id", "fabric_type_id", "category_id", "base_uom_id"],
  GEN: ["item_class_id", "category_id", "item_type_name", "base_uom_id"],
  A: ["item_class_id", "category_id", "base_uom_id"],
  C: ["item_class_id", "category_id", "base_uom_id"],
};

/** Human labels, so a caller can say WHICH field without re-deriving it. */
export const MATERIAL_FIELD_LABELS: Partial<Record<keyof MaterialInput, string>> = {
  item_class_id: "Item Class",
  yarn_type_id: "Yarn Type",
  count_id: "Count",
  category_id: "Category",
  base_uom_id: "Base UOM",
  fabric_type_id: "Fabric Type",
  item_type_name: "Item Type",
  fabric_using: "Using",
};

/**
 * Mandatory only in a particular STATE of the record — the class alone does not
 * settle it, so these cannot live in `REQUIRED_BY_FORM` above.
 *
 * `fabric_using` is the one so far (client 2026-08-06): a Fabric must say what
 * it is made of — Single or Multiple Yarn — because that answer is what opens
 * the Composition grid beneath it. UNLESS **Direct Purchase** is ticked, which
 * is the operator saying the fabric is bought ready-made: the screen then hides
 * Using and wipes the composition rows, and requiring a hidden field is a record
 * that cannot be saved with nothing on screen to explain why.
 *
 * With no `input` (the bare `isMaterialFieldRequired` call that only wants to
 * know whether to draw a `*`) the answer is the default state — required. The
 * screen passes its form, so its `*` and its hold follow Direct Purchase live.
 */
function stateRequired(
  form: MaterialFormKey,
  input?: Partial<MaterialInput>,
): readonly (keyof MaterialInput)[] {
  if (form === "FABRIC" && !input?.direct_purchase) return ["fabric_using"];
  return [];
}

/** Is this field mandatory for this class? Drives the `*` and the cursor hold. */
export function isMaterialFieldRequired(
  field: keyof MaterialInput,
  classCode: string | null | undefined,
  /** The record as it stands, for the fields whose requiredness depends on it. */
  input?: Partial<MaterialInput>,
): boolean {
  const form = itemClassForm(classCode);
  return REQUIRED_BY_FORM[form].includes(field) || stateRequired(form, input).includes(field);
}

/**
 * The mandatory fields this material has left blank, as labels. Empty = complete.
 *
 * Deliberately tolerant of a partial object so the screen can call it on its
 * in-progress form state, which is the only way the Save button and the field
 * `*`s can be guaranteed to agree with what the action will decide.
 */
export function missingRequiredMaterialFields(
  input: Partial<MaterialInput>,
  classCode: string | null | undefined,
): string[] {
  const form = itemClassForm(classCode);
  return [...REQUIRED_BY_FORM[form], ...stateRequired(form, input)]
    .filter((f) => {
      const v = input[f];
      return v == null || (typeof v === "string" && v.trim() === "");
    })
    .map((f) => MATERIAL_FIELD_LABELS[f] ?? String(f));
}

/** Sewing and Packing are the accessory classes: their materials are named from
 *  the Material Attribute questions configured per (Item Class + Category), and
 *  their "Type" is a Transaction Type (Purchased/Converted, no Production).
 *
 *  Do NOT infer this from `itemClassForm() === "A"`. Form A is the *default*
 *  bucket above, so Capital Goods lands in it too (as General did until it got
 *  its own form) — and that is exactly how they picked up an attribute flow they
 *  have no config for, which disabled their Save and made their Name read-only,
 *  leaving no way to create one at all (client 2026-07-28). `formKey === "A"`
 *  means "not Fabric/Yarn/General/Garments", never "is an accessory". */
export const ACCESSORY_CLASS_CODES = new Set(["SEW", "PACK"]);
export function isAccessoryClass(code: string | null | undefined): boolean {
  return !!code && ACCESSORY_CLASS_CODES.has(code.toUpperCase());
}

/** Classes counted in whole units, so every UOM prefills to Numbers: accessories
 *  are counted, and garments are handled as pieces (client 2026-07-28).
 *
 *  Deliberately a SEPARATE set from ACCESSORY_CLASS_CODES rather than adding
 *  "GAR" to it. That set does double duty — it also switches on the
 *  attribute-driven naming flow — so widening it to reach the UOM default would
 *  silently hand Garments the Material Attribute question grid and a read-only
 *  auto-composed Name, which is the exact opposite of what Garments is for. Two
 *  meanings, two sets. */
export const NUMBERS_UOM_CLASS_CODES = new Set(["SEW", "PACK", "GAR"]);
export function usesNumbersUom(code: string | null | undefined): boolean {
  return !!code && NUMBERS_UOM_CLASS_CODES.has(code.toUpperCase());
}

/**
 * Does this Yarn have to declare a mixing composition?
 *
 * ONE rule with three readers, which is the whole point of it being here: the
 * Materials master shows the grid on it (`yarnMixingVisible`), the Yarn
 * quick-create sheet shows its own grid on it, and `mixingRequiredError`
 * (material-actions.ts) refuses the save without it. A grid that is not on
 * screen must never be what blocks Save, so "is it shown" and "is it required"
 * have to be the same expression — and a form that cannot show the grid at all
 * is a form that cannot satisfy the rule, which is exactly how the quick-create
 * sheet became unable to save a Mixed yarn (client 2026-08-11).
 *
 * It lives in this file rather than beside its server-side caller for the
 * reason `missingRequiredMaterialFields` above does: a `"use server"` module
 * may only export async functions, so a predicate a client component has to
 * evaluate synchronously — to gate a Save button on a keystroke — cannot live
 * there. It was exported from one until this moved it.
 *
 * **The yarn-type half is a read-by-NAME coupling**, pre-existing rather than
 * introduced here (`extras-types.ts` documents it where the `yarn_type` kind is
 * declared): Twisted / Doubling / Melange are recognised by their lookup NAME
 * because the seeded rows carry no stable code to key on. Renaming one of those
 * values silently changes which yarns need a mixing composition — in all three
 * readers at once, which is the most that can be promised while the coupling
 * exists. `yarn_type` is a CLOSED lookup partly for this reason. Do not "fix"
 * only one side.
 */
export function yarnMixingApplies(
  categoryMade: string | null | undefined,
  yarnTypeName: string | null | undefined,
): boolean {
  const t = yarnTypeName?.toLowerCase() ?? null;
  return categoryMade === "Mixed" || t === "twisted" || t === "doubling" || t === "melange";
}

// ---------------------------------------------------------------------------
// Fabric structure → UOM. A PREFILL, and overridable (client 2026-08-04).
//
//   Circular Knit  base KGS   alternative — none
//   Flat Knit      base NOS   alternative KGS
//   Woven          base MTR   alternative KGS
//
// READ THE HISTORY BEFORE CHANGING THIS — it has moved three times and each
// version looks like the "obvious" one from inside the next:
//
//   2026-07-24  a prefill, freely overridable (Circular/Flat KGS, Woven MTR)
//   2026-08-01  FIXED. Flat Knit moved KGS → NOS, the screen went read-only and
//               the server re-derived on every save
//   2026-08-04  a prefill again, and overridable — but keeping 08-01's UNITS
//
// The last step came from a request for a "default base uom", and a default is
// something you can change. So `material-master-screen.tsx` prefills Base from
// this table when the STRUCTURE changes and leaves the operator the last word,
// and `applyFabricUomRule` only supplies a base that is missing. What did NOT
// come back is 07-24's unit table: Flat Knit stays NOS and Woven stays MTR,
// because `doc/recording/business logic.md` records Flat Knit as "Pcs & KG —
// used for collars/cuffs, requires tracking by both unit count and physical
// weight for costing", and the `secondary` row below is the only place "10
// collars = 1 KG" is written down. Circular Knit is ~90% of fabric and is KGS in
// every version, so "fabric should be KGS" is satisfied for almost all of it
// without deleting that costing input.
//
// Existing records were deliberately NOT migrated at any step. A Flat Knit
// stocked in KGS before 08-01 keeps KGS until someone changes it by hand, and
// the screen warns when the unit on the form differs from the stored one —
// a booked quantity does not change meaning because the label above it did.
//
// `secondary` is the alternative unit — the second half of the conversion row
// (the QUANTITIES on that row stay the operator's: how many kilos a knitted
// panel weighs is per-material and cannot be derived from anything here).
//
// Structure lives on Category (0279), Material just reads it. Keys match
// config_lookups kind `fabric_structure` (0279), seeded from the same values as
// the existing `styles.fabric_type` CHECK.
// ---------------------------------------------------------------------------
export const FABRIC_STRUCTURE_UOM: Record<string, { base: string; secondary?: string }> = {
  circular: { base: "kg" },
  flat_knit: { base: "nos", secondary: "kg" },
  woven: { base: "mtr", secondary: "kg" },
};

/** Look the rule up by structure code, case-insensitively — `config_lookups`
 *  seeds these lowercase but nothing stops a row being edited to "Woven". */
export function fabricStructureUom(code: string | null | undefined) {
  return code ? FABRIC_STRUCTURE_UOM[code.toLowerCase()] ?? null : null;
}

/**
 * A class whose Base unit is **FIXED, not merely defaulted** — the dropdown
 * offers that unit and nothing else, and the server refuses anything else
 * (client 2026-08-11).
 *
 * **This is deliberately NOT what fabric does, and the difference is evidence,
 * not taste.** Fabric's base has flipped prefill → locked → prefill three times
 * (see the history above `applyFabricUomRule`) and must stay a prefill, because
 * `doc/recording/business logic.md` records Flat Knit as "Pcs & KG — used for
 * collars/cuffs, requires tracking by both unit count and physical weight for
 * costing". Locking fabric would delete a costing input. **Yarn has no such
 * counter-case anywhere in the docs**: "Yarn is always traded in KG" (0279 #15)
 * — *always*, not *usually*, which is why a lock is honest here and was not
 * there. So a request to add a class to this table is a request for that same
 * evidence: find the unit pairing the business needs, or there isn't one.
 *
 * Only classes with exactly ONE correct unit belong here. Checked against live
 * data before YARN was added — 14 yarns on KGS, 5 with none, none on anything
 * else, so the lock strands no existing record. Garments (PCS 4 / NOS 1) and
 * Sewing (NOS 4 / MTR 1) are genuinely mixed and must NOT be added.
 *
 * Values are unit CODES resolved through `resolveUomId`, never compared with
 * `===` — the master is seeded `kg` and live rows spell it `KGS`.
 */
export const CLASS_BASE_UOM: Record<string, string> = {
  YARN: "kg",
};

/** The fixed Base unit for an item class, or null when the class may choose.
 *  One declaration read by the screen (which offers only this unit) and by both
 *  server actions (which enforce it) — `lib/data-io` imports reach the actions
 *  without passing the screen, so a screen-only filter would guard nothing. */
export function classBaseUom(classCode: string | null | undefined): string | null {
  return classCode ? CLASS_BASE_UOM[classCode.toUpperCase()] ?? null : null;
}

/** The Stock Unit master is seeded lowercase (`kg`, `nos`, `mtr` — 0004) but
 *  live rows spell the same units `KGS`, `NOS`, `MTR`, and a shop that renamed
 *  one is not wrong. So a rule written in terms of a unit CODE resolves through
 *  this list, never by `===`. Active wins: a deactivated `kg` must never be the
 *  unit a fabric is forced onto. */
export const UOM_CODE_SYNONYMS: Record<string, string[]> = {
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  nos: ["nos", "no", "num", "number", "numbers", "pc", "pcs", "piece", "pieces"],
  mtr: ["mtr", "mtrs", "m", "mts", "meter", "meters", "metre", "metres"],
};

export type UomLike = { id: string; code: string; is_active: boolean };

/** Resolve a unit CODE from the rules above to a `uoms.id`. Returns null when
 *  the shop's unit master has no such unit — callers must then leave the field
 *  alone rather than blank it, since writing null would clear a saved UOM. */
export function resolveUomId(units: readonly UomLike[], want: string): string | null {
  const names = UOM_CODE_SYNONYMS[want.toLowerCase()] ?? [want.toLowerCase()];
  const match = (u: UomLike) => names.includes(u.code.toLowerCase());
  return units.find((u) => u.is_active && match(u))?.id ?? units.find(match)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Zod input
// ---------------------------------------------------------------------------
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const mixingInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  description: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  uom_id: uuidN,
  component_item_id: uuidN,
  count_id: uuidN,
  blend_pct: numN,
});
export const conversionInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  alt_qty: numN,
  alt_uom_id: uuidN,
  base_qty: numN,
  base_uom_id: uuidN,
});
export const usingItemInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  used_item_id: uuidN,
  description: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  uom_id: uuidN,
});
export const itemAttributeValueInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  attribute_line_id: z.string().uuid().nullable().default(null),
  value: z.string().nullable().default(null),
});

export const materialInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: capsTextNullable(), // falls back to code
  is_active: z.boolean().default(true),
  item_class_id: uuidN,
  hsn_code: nullableFormat(HSN_RE, "HSN/SAC must be 4, 6 or 8 digits"),
  hsn_id: uuidN,
  category_id: uuidN,
  sub_category_id: uuidN,
  // General only (0350) — the Name is composed from these, but they are stored
  // in their own columns so an edit re-opens with the parts, not a split string.
  item_type_name: z.string().optional().nullable(),
  item_base_name: z.string().optional().nullable(),
  material_type: z.string().optional().nullable(),
  user_defined: z.boolean().default(false),
  specifications: z.string().optional().nullable(),
  short_spec: z.string().max(200, "Short spec max 200 chars").optional().nullable(),
  count_id: uuidN,
  purity_id: uuidN,
  shade: z.string().optional().nullable(),
  fabric_type_id: uuidN,
  fabric_structure_id: uuidN,
  fabric_using: z.string().optional().nullable(),
  yarn_type_id: uuidN,
  direct_purchase: z.boolean().default(false),
  has_alternate_uom: z.boolean().default(false),
  base_uom_id: uuidN,
  stock_uom_id: uuidN,
  billing_uom_id: uuidN,
  planning_uom_id: uuidN,
  purchase_uom_id: uuidN,
  cost_head_id: uuidN,
  budget_rate: z.coerce.number().nonnegative().nullable().default(null),
  budget_rate_uom_id: uuidN,
  mixings: z.array(mixingInput).default([]),
  conversions: z.array(conversionInput).default([]),
  using_items: z.array(usingItemInput).default([]),
  item_attribute_values: z.array(itemAttributeValueInput).default([]),
}).refine(
  (d) => {
    const pcts = d.mixings.map((m) => m.blend_pct).filter((v): v is number => v != null);
    if (pcts.length === 0) return true;
    const sum = pcts.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 100) < 0.01;
  },
  { message: "Mixing percentages must add up to exactly 100%", path: ["mixings"] },
);
export type MaterialInput = z.infer<typeof materialInput>;
