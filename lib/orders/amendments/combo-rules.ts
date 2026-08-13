/**
 * Garment Order ▸ Combos ▸ Structure Details — the two rules that grid carries.
 *
 * The file 0397's header promised and 0408/0409 finally gave something to hold.
 * Both rules are exported functions rather than inline expressions for the
 * reason `missingRequiredMaterialFields` is (AGENTS.md, "Mandatory fields"):
 * the screen, the Save button and the server action must all be able to ask the
 * same question and get the same answer, and three copies of a rule stay
 * identical exactly until one of them is improved.
 */

/** Trim a number to the shortest honest string: 195, not 195.00. */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * "Gsm Range" — DERIVED, never stored (0408).
 *
 * The legacy screen shows 200 ± 5 as `195 - 205`, on all three rows of
 * screenshot 2259. It is a subtraction and an addition, so giving it a column
 * would be a second source of truth for arithmetic — the same argument Order
 * Unit already settled on the Style(s) tab, where the value is resolved on
 * every read precisely so the two can never drift.
 *
 * A TOLERANCE OF NOTHING IS NOT A RANGE OF NOTHING. With no tolerance the
 * honest answer is the GSM itself, not "200 - 200", which reads like a range
 * that was computed and came out empty. With no GSM there is no answer at all
 * and the cell stays blank rather than printing a stray "0".
 */
export function gsmRange(
  gsm: number | string | null | undefined,
  tolerance: number | string | null | undefined,
): string {
  const g = Number(gsm);
  if (!gsm && gsm !== 0) return "";
  if (!Number.isFinite(g) || g === 0) return "";
  const t = Number(tolerance);
  if (!Number.isFinite(t) || t === 0) return num(g);
  return `${num(g - t)} - ${num(g + t)}`;
}

/**
 * Is this structure a circular knit? — asked of the CATEGORY's knit family.
 *
 * The whole point of 0409. `structure_id` names a fabric category (SINGLE
 * JERSEY, 1X1 LYCRA RIB) and the category names its family through
 * `fabric_structure_id` (Circular Knit / Flat Knit / Woven), so the operator
 * answers once and this reads the consequence. Asking the family as its own
 * cell would let the two disagree on the same row.
 *
 * MATCHED ON THE LOOKUP'S `code`, NOT ITS NAME. The three rows are seeded
 * `circular` / `flat_knit` / `woven`, and a code is what survives someone
 * renaming "Circular Knit" to "Circular Knitting" from the picker's pencil —
 * which is a thing that list allows. A name match would compile, run, and
 * quietly stop making GSM compulsory.
 */
export function isCircularKnit(familyCode: string | null | undefined): boolean {
  return (familyCode ?? "").trim().toLowerCase() === "circular";
}

/** One structure row, as far as the rules need to see it. */
export type ComboStructureLike = {
  structure_id: string | null;
  gsm: string | number | null;
};

/**
 * What is wrong with this structure row — empty array means nothing.
 *
 * "Circular Knit → GSM compulsory; Woven or Flat Knit → optional" (client
 * 2026-08-10, recorded in 0397's header). Requiredness that is a property of
 * the CASE rather than of the column, which is exactly why it cannot be a
 * `required` prop on the cell and cannot be a CHECK in SQL: the row stores a
 * category uuid, and neither Zod nor Postgres can see through it to the family
 * without a join. 0397 said as much and had nowhere to put the rule; this is
 * the somewhere.
 *
 * IT TAKES THE FAMILY CODE AS AN ARGUMENT rather than looking it up, so the
 * caller that already holds the categories list does the resolving once. A
 * function that fetched would be unusable in the Save button, which has to
 * answer on every keystroke.
 *
 * A STRUCTURE THAT NAMES NO CATEGORY IS NOT AN ERROR HERE. It is a row the
 * operator is still filling in, and the blank Structure cell is what says so —
 * reporting a missing GSM for a row that has not chosen a fabric yet would
 * scold them for the wrong field.
 */
export function structureProblems(
  row: ComboStructureLike,
  familyCode: string | null | undefined,
): string[] {
  const problems: string[] = [];
  if (!row.structure_id) return problems;
  if (isCircularKnit(familyCode) && !row.gsm && row.gsm !== 0) {
    problems.push("GSM is required for a circular-knit structure");
  }
  return problems;
}

/**
 * Main Fabric / Trims Fabric — the "Type" column.
 *
 * NOT the Style master's "Type". That one is `garment_style_components.comp_type`
 * and is derived from the fabric category's structure (0405); this one is
 * `order_fabrics.fabric_type` and asks whether the fabric is the garment's body
 * or its trims. Same word, same screen family, different question — which is
 * why the two vocabularies are declared apart rather than shared.
 *
 * The VALUES are 0329's (`'main'`, `'trims_fabric'`) so the order-side seeder
 * is a copy rather than a translation; the LABELS are what the legacy screen
 * prints.
 */
export const FABRIC_TYPE_OPTIONS = [
  { value: "main", label: "Main Fabric" },
  { value: "trims_fabric", label: "Trims Fabric" },
] as const;

/**
 * Solid / Melange / Yarn Dyed / Printed — the "Fabric Type" column.
 *
 * The first three are `order_fabrics.item_sub_type` (0329), which the Color/Print
 * tab already counts to explain why a melange or yarn-dyed fabric needs no dyeing
 * row (`FabricTypeCounts` in order-seed.ts): melange takes its colour from the
 * purchased yarn, yarn-dyed is coloured before knitting.
 *
 * PRINTED IS THE AMENDMENT'S OWN FOURTH (0412, client 2026-08-12). The order side
 * never needed it — its three answers exist to settle "does this fabric need a
 * dyeing row?", and a printed fabric is not a fourth way of being dyed. Here it
 * decides which aesthetic field applies, so it has to be sayable. The consequence
 * is worth knowing: a SEEDED amendment can never arrive holding `printed`, because
 * the order it seeds from cannot express it — the operator sets it.
 */
export const ITEM_SUB_TYPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "melange", label: "Melange" },
  { value: "yarn_dyed", label: "Yarn Dyed" },
  { value: "printed", label: "Printed" },
] as const;

export type ItemSubType = (typeof ITEM_SUB_TYPE_OPTIONS)[number]["value"];

/**
 * Narrow a screen's `<Select>` value to the vocabulary — anything else is null.
 *
 * A `<select>` hands back a `string`, the payload column takes one of four
 * words or nothing, and 0415 put a CHECK on the column. Without this the gap is
 * bridged by an `as` at the call site, which is not a check at all: it silences
 * the compiler and lets a stale value reach Postgres to be refused as a raw
 * database error instead of a field the operator can see.
 *
 * "" MAPS TO NULL rather than being rejected, because "" is what a cleared
 * Select reads as and "not answered" is a legitimate state here — the branch
 * `takesDyedColour` and `takesAllOverPrint` both answer false for.
 */
export function asItemSubType(v: string | null | undefined): ItemSubType | null {
  return ITEM_SUB_TYPE_OPTIONS.some((o) => o.value === v) ? (v as ItemSubType) : null;
}

/**
 * WHICH AESTHETIC FIELD A COMPONENT FILLS, decided by its structure's Fabric
 * Type (client 2026-08-12). One function, because the two cells must agree:
 * if both answered "yes" the operator would be asked to specify a colour AND a
 * print for one fabric, and if both answered "no" the row could not be
 * described at all.
 *
 *   solid     → a dyed colour, from the order's declared dyeing rows
 *   printed   → an all-over print, from the order's declared prints
 *   melange   → neither: the colour comes from the purchased yarn
 *   yarn_dyed → neither: it is coloured before knitting
 *   (blank)   → neither, and this is the branch that matters. A rule phrased as
 *               "restrict only when melange" leaks through every state that is
 *               not melange — how the nominated-vendor rule broke twice.
 *
 * NEITHER IS A HARD BLOCK. These decide which list is OFFERED; the colour cell
 * still accepts free text, because an order part-way through entry must stay
 * fillable. Guided, never caged — the same line `keyFills` draws.
 */
export function takesDyedColour(itemSubType: string | null | undefined): boolean {
  return itemSubType === "solid";
}
export function takesAllOverPrint(itemSubType: string | null | undefined): boolean {
  return itemSubType === "printed";
}

export const fabricTypeLabel = (v: string | null | undefined): string =>
  FABRIC_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";
export const itemSubTypeLabel = (v: string | null | undefined): string =>
  ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";
