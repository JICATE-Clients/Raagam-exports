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

import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

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
 * Type (client 2026-08-12). One pair, because the two cells must agree: if both
 * answered "yes" the operator would be asked for a colour AND a print on one
 * fabric, and if both answered "no" the row could not be described at all.
 *
 *   solid | melange | yarn_dyed → a colour, from the matching half of the
 *                                order's declared palette (`colourSourceFor`)
 *   printed                     → an all-over print, from the declared prints
 *   (blank)                     → neither, and this is the branch that matters.
 *                                A rule phrased as "restrict only when melange"
 *                                leaks through every state that is not melange
 *                                — how the nominated-vendor rule broke twice.
 *
 * NEITHER IS A HARD BLOCK. These decide which list is OFFERED; the colour cell
 * still accepts free text, because an order part-way through entry must stay
 * fillable. Guided, never caged — the same line `keyFills` draws.
 */
export function takesAllOverPrint(itemSubType: string | null | undefined): boolean {
  return itemSubType === "printed";
}

/**
 * WHICH DECLARED COLOURS A FABRIC MAY TAKE — client 2026-08-20:
 * "the color print tab we will list the color which is which type yarn dyed or
 * melange … if i choose solid, solid color only filtered list, and then melange
 * is choosed melange color only need to list."
 *
 * THIS REPLACES `takesDyedColour`, WHICH ANSWERED THE WRONG QUESTION. It gave a
 * colour list to `solid` alone, reasoning that a melange takes its colour from
 * the purchased yarn and a yarn-dyed fabric is coloured before knitting, so
 * neither is DYED to a declared colour. Every word of that is true and it does
 * not decide this field: the cell asks WHAT COLOUR THIS CLOTH IS, not how it got
 * that way. The reasoning is preserved here so a later reader does not restore
 * the old gate by citing it — it is superseded by a client decision, not by an
 * argument.
 *
 * Both halves of the old rule were live defects on real data (catalog,
 * 2026-08-20): the order's palette holds six `Dyed` colours and one `Melange`,
 * so a Solid fabric was offered GREY MELANGE, and a Melange fabric was offered
 * nothing while GREY MELANGE sat declared on the very tab this reads.
 *
 * The tag has always been there. `DYE_TYPE_OPTIONS` (types.ts) gives a yarn
 * dyeing row `Y/D` | `Melange` and a fabric one `Dyed` | `Melange`; Structure
 * Details simply never read it.
 *
 * MELANGE READS BOTH GRIDS. "Melange" is offered on the yarn list and the fabric
 * list alike, and which one an operator happened to use is not a distinction the
 * colour itself carries — narrowing it to one section would produce a false
 * empty the moment somebody entered it on the other.
 *
 * `null` means "this fabric does not take a declared colour at all", which is
 * printed (it takes a print) and blank (it takes nothing until answered). That
 * is what keeps the invariant with `takesAllOverPrint` above: exactly one of the
 * two cells can ever claim a row, and neither claims an unanswered one.
 */
export type ColourSource = {
  /** `dye_type` values on a Color/Print row that may answer this fabric. */
  types: readonly string[];
  /** Which dyeing grid those rows may sit in. */
  sections: readonly ("yarn" | "fabric")[];
};

export function colourSourceFor(
  itemSubType: string | null | undefined,
): ColourSource | null {
  if (itemSubType === "solid") return { types: ["Dyed"], sections: ["fabric"] };
  if (itemSubType === "yarn_dyed") return { types: ["Y/D"], sections: ["yarn"] };
  if (itemSubType === "melange")
    return { types: ["Melange"], sections: ["yarn", "fabric"] };
  return null;
}

/** One Color/Print dyeing row, as the colour filter reads it. */
export type DeclaredColour = {
  section: string;
  dye_type: string;
  color_name: string;
};

/**
 * The colours this order declared that a fabric of this type may be given.
 *
 * DEDUPED BY NAME, because melange reads two grids and the same colour may be
 * declared on both — and because the cell stores `color_name`, so two rows
 * naming one colour are one option.
 *
 * AN UNRECOGNISED `dye_type` MATCHES NOTHING. The column was free TEXT until
 * 2026-08-17, so a stored value need not be in either list. Excluding it is safe
 * in a way it would not be on a picker: this cell is a Combobox over
 * `color_name` — free text — so a colour that stops being OFFERED is still
 * displayed, still saved, and still typeable. Nothing a row already holds is
 * lost, which is the "Disabled rows" guarantee arrived at for free.
 *
 * NEVER FALLS BACK TO THE WHOLE PALETTE when the match is empty. That fallback
 * is exactly what puts GREY MELANGE back on a solid fabric — the defect this
 * function exists to remove. An order that has declared no yarn-dyed colour
 * offers none, and the operator types one.
 */
export function declaredColoursFor(
  rows: readonly DeclaredColour[],
  itemSubType: string | null | undefined,
): string[] {
  const src = colourSourceFor(itemSubType);
  if (!src) return [];
  const norm = (v: string) => v.trim().toUpperCase();
  const wantTypes = src.types.map(norm);
  const out: string[] = [];
  for (const r of rows) {
    if (!src.sections.includes(r.section as "yarn" | "fabric")) continue;
    if (!wantTypes.includes(norm(r.dye_type))) continue;
    const name = norm(r.color_name);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * ONE PART OF A FABRIC, as the mandatory-field rule needs to see it.
 *
 * `color_name` IS THE WIDEST OF THE THREE SPELLINGS ON PURPOSE. The screen holds
 * a plain `string`, the Zod-parsed payload holds `string | null | undefined`
 * (`capsTextNullable()` has a default, so the key may be absent), and this rule
 * has to answer for both callers. Narrowing it to `string | null` here would
 * compile on the screen and reject the server — which is the exact drift the
 * one-function convention exists to prevent.
 */
export type ComboComponentLike = {
  coordinate_id: string | null;
  component_id: string | null;
  color_name?: string | null;
};

/** Has this part been answered at all? — the twin of `componentFilled` in
 *  `actions.ts`, restricted to the three cells this rule governs. */
function componentSaysSomething(c: ComboComponentLike): boolean {
  return !!(c.coordinate_id || c.component_id || (c.color_name ?? "").trim());
}

/**
 * WHAT IS MISSING FROM THIS PART — empty array means nothing (client
 * 2026-08-21: "coordinate, component, color set as required field").
 *
 * The component half of `structureProblems` above, and it lives here for the
 * same reason: the cell's `required` prop, the Save button and the server action
 * must all be able to ask the same question and get the same answer.
 *
 * COORDINATE AND COMPONENT ARE ALWAYS REQUIRED. They are what IDENTIFIES a part
 * — which piece of the garment this is — which is also why `addComp` already
 * refuses to open a second part while the first names neither.
 *
 * COLOUR IS REQUIRED ONLY WHERE A COLOUR APPLIES, and that is not a softening of
 * the rule. The cell is offered `declaredColoursFor(rows, itemSubType)`, which is
 * EMPTY on a `printed` fabric and on one whose Fabric Type is still blank — so an
 * unconditional hold would refuse to release a cell the app has nothing to fill
 * from, and the only ways out would be free text, Escape, Ctrl+Del or the mouse.
 * That is the "requiring a hidden field is a record that cannot be saved with
 * nothing on screen to say why" trap in AGENTS.md, one door along: not hidden,
 * but unanswerable. Requiredness here is a property of the field FOR A STATE.
 *
 * IT ASKS `colourSourceFor`, NEVER THE FOUR LITERALS. The list the cell offers
 * and the requiredness of the cell are then one decision — re-testing
 * `=== "printed"` here would compile, run, and drift the first time the palette
 * rule changed (which it already has once, on 2026-08-20).
 *
 * A PART THAT SAYS NOTHING AT ALL IS NOT AN ERROR. `addComp` opens a blank row
 * for the operator to type into and `componentFilled` (actions.ts) drops it on
 * save, so reporting it would deaden Save the moment the overlay opened — the
 * same abstention `structureProblems` makes for a structure naming no category,
 * and the same guard `quantityProblems` puts on a blank assortment line. The
 * blank row is still HELD by the cursor, which is the per-field rule and a
 * different question from whether the document may be saved.
 */
export function componentProblems(
  comp: ComboComponentLike,
  itemSubType: string | null | undefined,
): string[] {
  const problems: string[] = [];
  if (!componentSaysSomething(comp)) return problems;
  if (!comp.coordinate_id) problems.push("Coordinate is required");
  if (!comp.component_id) problems.push("Component is required");
  if (colourSourceFor(itemSubType) && !(comp.color_name ?? "").trim()) {
    problems.push("Colour is required");
  }
  return problems;
}

export const fabricTypeLabel = (v: string | null | undefined): string =>
  FABRIC_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";
export const itemSubTypeLabel = (v: string | null | undefined): string =>
  ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";

/* ------------------------------------------------------------------------- *
 * THE COMPOSITION A STRUCTURE IS MADE OF (0434)
 * ------------------------------------------------------------------------- */

/**
 * ONE MIXING LINE, as the match reads it. `pct` is nullable because a
 * single-component fabric stores no share at all (9 of the 14 live FABRIC items
 * are in exactly that state) — see `blendOf` for what that means.
 */
export type MixingShare = { category_id: string | null; pct: number | null };

/** A FABRIC material reduced to what the match needs. */
export type FabricBlend = {
  id: string;
  /** The fabric CATEGORY — what the Structure cell holds. */
  category_id: string | null;
  mixing: readonly MixingShare[];
};

/**
 * A composition reduced to the same shape. `Deactivatable` rather than a bare
 * `inactive`, so a feeder only has to SELECT its own column and the rule reads
 * it through `isInactive()` — the schema spells the flag three ways and this is
 * the one place both callers would otherwise each get it wrong.
 */
export type CompositionBlend = Deactivatable & {
  id: string;
  lines: readonly { category_id: string | null; mixing_pct: number }[];
};

/**
 * A blend as a CANONICAL MULTISET — yarn category id → summed percentage.
 *
 * Summing repeats is the only normalisation there is, and it is exact rather
 * than approximate: `SOLID FLEECE` names cotton twice (30'S COMBED 55% and 16'S
 * COMPACT 35%), and as a COMPOSITION that fabric is COTTON 90% / POLYESTER 10%.
 * A composition speaks in categories; a fabric's mixing speaks in yarn items.
 * Collapsing to the category is what makes the two comparable at all.
 *
 * `null` MEANS "CANNOT BE READ", and it is deliberately not an empty map: two
 * unreadable blends would then compare equal and match each other.
 *
 * The percentage rules, each of which a live row depends on:
 * - ONE line with no share means 100. A single component IS the whole cloth,
 *   and this is 9 of the 14 fabrics.
 * - MORE than one line with ANY share missing is unreadable. `YARN DYED SINGLE
 *   JERSEY (10'S COMBED COTTON, 10'S GREY MELANGE)` is exactly that row: the
 *   split is genuinely unknown, and assuming an even one would invent a figure
 *   the master never stated. Refusing is the same call `getFabricRows` already
 *   makes when it renders those yarns with no "0%" beside them.
 * - A line whose yarn carries no category cannot be keyed, so the whole blend
 *   is unreadable. None today; that is not something to rely on.
 */
export function blendOf(mixing: readonly MixingShare[]): Map<string, number> | null {
  if (!mixing.length) return null;
  const single = mixing.length === 1;
  const out = new Map<string, number>();
  for (const m of mixing) {
    if (!m.category_id) return null;
    // `pct` is nullable only for the single-line case above; anywhere else a
    // missing share makes the whole blend unreadable rather than assumed.
    const pct = m.pct == null ? (single ? 100 : null) : m.pct;
    if (pct == null || !Number.isFinite(pct)) return null;
    out.set(m.category_id, (out.get(m.category_id) ?? 0) + pct);
  }
  return out.size ? out : null;
}

/**
 * The same canonicalisation from the master's side.
 *
 * A line with no `category_id` makes its composition unmatchable — pre-0384
 * rows are the case, and the live `Test Composition` is one. It returns `null`
 * rather than throwing, and it must NEVER key such a line on the string
 * `"null"`: two categoryless lines would then agree with each other and the
 * rule would confidently match the wrong record.
 */
export function blendOfComposition(c: CompositionBlend): Map<string, number> | null {
  if (!c.lines.length) return null;
  const out = new Map<string, number>();
  for (const l of c.lines) {
    if (!l.category_id) return null;
    const pct = Number(l.mixing_pct);
    if (!Number.isFinite(pct)) return null;
    out.set(l.category_id, (out.get(l.category_id) ?? 0) + pct);
  }
  return out.size ? out : null;
}

/** Both columns are `numeric(6,2)`, so this is lossless on both sides. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * STRICT multiset equality — same categories, same shares to 2dp.
 *
 * There is no tolerance band and there should not be one. The two columns
 * (`material_mixings.blend_pct`, `composition_lines.mixing_pct`) are the same
 * numeric type at the same precision, so there is no float drift for a band to
 * absorb — it would buy nothing and cost correctness: COTTON 95 / ELASTANE 5
 * and COTTON 90 / ELASTANE 10 are different cloth, a different price and a
 * different customer approval.
 */
function sameBlend(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [cat, pct] of a) {
    const other = b.get(cat);
    if (other === undefined || round2(other) !== round2(pct)) return false;
  }
  return true;
}

/**
 * THE RULE: which composition a structure is made of, or `null`.
 *
 * Structure (a fabric CATEGORY) → its sole fabric → that fabric's blend → the
 * composition stating the same blend. This is what keeps 0430's "fetch it from
 * the previous tab automatically" true while the cell reads the master again;
 * `pickComboStructure` and `order-seed.ts` both call it, so the screen and the
 * server cannot answer differently.
 *
 * IT ABSTAINS AT EVERY AMBIGUITY, and `null` always means "leave the cell
 * alone" — never "clear it". Same shape as `componentTypeForCategory`.
 *
 *   no structure                  → null
 *   category holds != 1 fabric    → null  (SINGLE JERSEY holds eight; the same
 *                                          unambiguous-only rule `soleFabricIn`
 *                                          already applies to the fabric)
 *   fabric's blend unreadable     → null  (see `blendOf`)
 *   composition line categoryless → that composition is SKIPPED, not fatal
 *   composition switched off      → skipped: never auto-fill a row the picker
 *                                   is about to hide
 *   two compositions match        → null: ambiguity is ambiguity
 *
 * NEVER MATCH ON THE LABEL. `getFabricRows` names the yarn ITEM (30'S COTTON
 * COMBED) and a composition names the CATEGORY (COTTON), so the two strings
 * differ by construction even when the blend is identical — and a string match
 * would break again the day someone renames a yarn. Ids and numbers only.
 */
export function compositionForStructure(
  structureId: string | null,
  fabrics: readonly FabricBlend[],
  compositions: readonly CompositionBlend[],
): string | null {
  if (!structureId) return null;
  const under = fabrics.filter((f) => f.category_id === structureId);
  if (under.length !== 1) return null;
  const want = blendOf(under[0].mixing);
  if (!want) return null;

  let found: string | null = null;
  for (const c of compositions) {
    if (isInactive(c)) continue;
    const have = blendOfComposition(c);
    if (!have || !sameBlend(want, have)) continue;
    if (found) return null; // two answers is no answer
    found = c.id;
  }
  return found;
}
