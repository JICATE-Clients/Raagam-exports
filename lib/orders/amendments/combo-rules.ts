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
/**
 * ±5% IS THE PREFILL A NEW FABRIC STARTS ON (client 2026-08-31: "the Tolerance
 * input field must automatically default to 5 … a ±5% weight/GSM variance is the
 * standard baseline tolerance in garment manufacturing").
 *
 * Editable, always — 3% for a buyer with tighter parameters, 8% for a looser
 * one. What a default cannot be allowed to become is an ANSWER, which is what
 * `toleranceStated` below exists to say.
 */
export const DEFAULT_GSM_TOLERANCE = 5;

/**
 * DOES THIS TOLERANCE COUNT AS SOMETHING THE OPERATOR SAID?
 *
 * A prefill is not an answer, and on this screen the difference is load-bearing
 * in three places at once — which is why it is one exported function rather than
 * three `!== "5"` tests that would drift the first time the baseline changed.
 *
 * The trap this closes, stated in full because it is silent in all three:
 *
 * 1. `structSaysSomething` (amendment-screen.tsx) is what makes
 *    `seedComboFromStyle` stand down — it seeds the tree from the style ONLY
 *    while no structure says anything. A blank fabric carrying a prefilled 5
 *    says something, so the seed would never run again on any order. Nothing
 *    errors; the [Detail] overlay just quietly stops filling itself in.
 * 2. `structureFilled` (actions.ts) is what decides whether a row is worth
 *    STORING. The same prefill would write one empty structure row per combo,
 *    for ever, and its twin above would then read them back as real.
 * 3. `carryDownGsm` copies fabric 1's GSM and tolerance into the fabrics below
 *    it, "blanks only" (client 2026-08-21). With a prefill, no tolerance is ever
 *    blank — so the carry-down the client asked for would decline every time.
 *
 * A DELIBERATE 5 IS INDISTINGUISHABLE FROM THE PREFILL and that is accepted, not
 * overlooked: the only row it costs is one whose sole content is a hand-typed
 * tolerance of exactly the default, which is a row that says nothing about the
 * cloth. Every other field on the structure votes independently.
 *
 * A GARBAGE VALUE IS CONTENT. `Number("abc")` is NaN and NaN !== 5, so a
 * half-typed or non-numeric tolerance reads as stated and the row is kept —
 * dropping it would delete what the operator was in the middle of typing.
 */
export function toleranceStated(v: string | number | null | undefined): boolean {
  const s = typeof v === "number" ? String(v) : (v ?? "").trim();
  if (!s) return false;
  return Number(s) !== DEFAULT_GSM_TOLERANCE;
}

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
  /* The three added 2026-08-31 — see `structureProblems`. Optional on the type
     so an older caller that has not been widened still compiles rather than
     silently passing `undefined` through a required field and reporting every
     row as incomplete. */
  composition_id?: string | null;
  gsm_tolerance?: string | number | null;
  item_sub_type?: string | null;
};

/** Which cells of a structure row the operator must answer. */
export type StructureRequiredCells = {
  structure: boolean;
  composition: boolean;
  gsm: boolean;
  gsm_tolerance: boolean;
  item_sub_type: boolean;
};

/**
 * WHICH CELLS THIS FABRIC MUST STATE — the one declaration, four readers
 * (client 2026-09-01: "the composition, gsm, Tolerance, Fabric type, color
 * these field are required field .. why is it not updated").
 *
 * ## WHY THIS EXISTS RATHER THAN A `required` PROP PER CELL
 *
 * `structureProblems` below already said, in capitals, that Composition,
 * Tolerance and Fabric Type are unconditionally required — and then declined to
 * put `required` on the cells, reasoning that four separate declarations of
 * "what does this structure still need" would be free to disagree. That
 * reasoning is right and is kept. What it got wrong is the CONCLUSION: it left
 * the rule as an amber sentence only, so on screen there was no red `*`, no
 * cursor hold and no blocked Save — every one of the four things this app means
 * by "required" (AGENTS.md, "Mandatory fields"). The client read the screen and
 * reported the field as not done, which it was.
 *
 * So the rule stays stated once and the cells DERIVE their `required` from it.
 * A star that appears without this function agreeing is the star/hold
 * divergence AGENTS.md exists to make impossible.
 *
 * ## IT TAKES THE FAMILY CODE, NOT THE ROW
 *
 * Requiredness is a property of the COLUMN for a given kind of cloth, never of
 * how far the operator has got — a `*` that appears once you pick a Structure
 * and vanishes when you clear it is a label that flickers. The "is this row
 * merely unfinished" judgement belongs to the caller, and `structureProblems`
 * below is where it is made.
 *
 * ## GSM STAYS THE CASE RULE, AND THAT IS A DELIBERATE READING
 *
 * The client's list names GSM alongside the other four. The client also said, on
 * 2026-08-10, "Circular Knit → GSM compulsory; Woven or Flat Knit → optional",
 * and that is the narrower, older and more specific statement — so it wins over
 * a list read off a screenshot of a blank row. In practice it costs nothing on
 * the orders this complaint came from: a knit garment's structures (Single
 * Jersey, 1×1 Lycra Rib) all resolve to `circular`, so the star and the hold are
 * there on every fabric the operator meets. Making GSM unconditional is a
 * one-line change HERE and needs the client to withdraw the 08-10 rule first.
 */
export function structureRequiredCells(
  familyCode: string | null | undefined,
): StructureRequiredCells {
  return {
    structure: true,
    composition: true,
    gsm: isCircularKnit(familyCode),
    gsm_tolerance: true,
    item_sub_type: true,
  };
}

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
  const need = structureRequiredCells(familyCode);
  if (need.gsm && !row.gsm && row.gsm !== 0) {
    problems.push("GSM is required for a circular-knit structure");
  }
  /*
   * COMPOSITION · TOLERANCE · FABRIC TYPE — UNCONDITIONALLY REQUIRED once the
   * row names a structure (client 2026-08-31).
   *
   * ## THEY JOIN THE GSM RULE RATHER THAN BECOMING `required` PROPS
   *
   * A `required` prop on each cell would have been less code and is the wrong
   * shape here, for the reason this function's header already gives about GSM:
   * the answer depends on the ROW, not on the column, and every one of these
   * complaints has to stand down for a row that has not chosen a fabric yet.
   * Three cell props plus the existing case rule would be four statements of
   * "what does this structure still need", free to disagree — and the one that
   * disagreed would be the one nobody reads, since a star is visible and a
   * blocked Save is not.
   *
   * So the row's requiredness is stated once, here, and the screen renders what
   * this returns. `undefined` is treated as missing exactly like `null`: a
   * caller that has not been widened yet should report the row as incomplete
   * rather than silently pass it, which is the direction that fails loudly.
   *
   * ## THE `!row.structure_id` GUARD ABOVE COVERS ALL FOUR, DELIBERATELY
   *
   * It is the same "a row the operator is still filling in" argument, and it is
   * what stops a freshly-added fabric printing four complaints before the
   * operator has typed anything — the premature-complaint failure the parts
   * grid's own `structTouched` gate exists to prevent one level down.
   */
  const blank = (v: string | number | null | undefined) =>
    v === null || v === undefined || (typeof v === "string" && !v.trim());

  if (need.composition && blank(row.composition_id)) {
    problems.push("Composition is required");
  }
  /* `!== 0` for the same reason GSM carries it: a tolerance of zero is an
     ANSWER — "no tolerance on this cloth" — and `!row.gsm_tolerance` alone
     would report it as unanswered and refuse a figure the operator meant. */
  if (
    need.gsm_tolerance &&
    blank(row.gsm_tolerance) &&
    row.gsm_tolerance !== 0
  ) {
    problems.push("Tolerance is required");
  }
  if (need.item_sub_type && blank(row.item_sub_type)) {
    problems.push("Fabric Type is required");
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
 * Solid / Melange / Yarn Dyed — the "Fabric Type" column.
 *
 * These are `order_fabrics.item_sub_type` (0329), which the Color/Print tab
 * already counts to explain why a melange or yarn-dyed fabric needs no dyeing
 * row (`FabricTypeCounts` in order-seed.ts): melange takes its colour from the
 * purchased yarn, yarn-dyed is coloured before knitting.
 *
 * ## `printed` IS GONE, AND IT WAS NOT A TIDY-UP (client 2026-08-31)
 *
 * "Fabric Type is meant to define the structural weave or dye category of the
 * fabric. 'Printed' is an aesthetic processing step, not a base fabric type.
 * Leaving it in the construction list causes planning confusion and corrupts
 * downstream material requirements."
 *
 * It was the amendment's own fourth answer (0412, client 2026-08-12), added
 * because Fabric Type used to decide WHICH aesthetic cell a part filled — a
 * colour or a print, never both. That job no longer exists: the client put
 * Colour and Fabric Print side by side on every part on 2026-08-20 (screenshots
 * 2403 · 2407), leaving `printed` deciding only which of two always-present
 * cells was allowed a list. So the option outlived its reason before it was
 * removed, which is why removing it costs nothing on screen.
 *
 * THE THREE VALUES NOW MATCH `order_fabrics` EXACTLY, which is what 0329's CHECK
 * always said. A seeded amendment could never arrive holding `printed` (the
 * order side cannot express it) and the catalog confirms none ever did: 0 rows
 * across both amendment tables on 2026-08-31, which is what made the CHECK safe
 * to tighten rather than having to carry a stale value for ever.
 *
 * **`takesAllOverPrint` WENT WITH IT.** See the note where it used to stand,
 * below `colourSourceFor` — a gate keyed on a value nothing can hold is not a
 * strict gate, it is a permanently closed one.
 */
export const ITEM_SUB_TYPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "melange", label: "Melange" },
  { value: "yarn_dyed", label: "Yarn Dyed" },
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
 * `componentColourEntry` answers `null` for.
 *
 * IT ALSO NARROWS `printed` AWAY, and that is deliberate rather than incidental
 * (client 2026-08-31). Nothing produces one: `order_fabrics`' CHECK never had
 * it, the catalog holds none, and 0478 removed it from both amendment CHECKs.
 * The one path that could still carry the word is a hand-written import through
 * `lib/data-io`, and mapping it to null there is the honest answer — the column
 * would refuse it anyway, as a raw database error instead of an empty cell.
 */
export function asItemSubType(v: string | null | undefined): ItemSubType | null {
  return ITEM_SUB_TYPE_OPTIONS.some((o) => o.value === v) ? (v as ItemSubType) : null;
}

/**
 * `takesAllOverPrint` STOOD HERE AND IS DELETED (client 2026-08-31).
 *
 * It answered `itemSubType === "printed"`, and it is the reason removing one
 * dropdown option is not a one-line change: with `printed` unsayable, the gate
 * could never again return true, and the per-part **Fabric Print** picker it
 * gates would have offered an empty list on every part of every order, for ever.
 * Nothing would have errored. A live cell would simply have stopped working —
 * the shape AGENTS.md records twice under `created_by` and the item-report
 * filter bar, where the code reads as correct and the value never arrives.
 *
 * THE CLIENT'S OWN RATIONALE IS THE FIX. "Printed is an aesthetic processing
 * step, not a base fabric type" — so printing is ORTHOGONAL to what the cloth is
 * made of, and any fabric may be printed. Fabric Print is therefore ungated:
 * `declaredPrintOptions` (amendment-screen.tsx) offers the prints this order
 * declared on the Color/Print tab, falling back to the `roll_form_print` master
 * when it declared none — its own three clauses, unchanged.
 *
 * WHAT IS NOT LOST: the 2026-08-12 pairing rule ("the operator must not be asked
 * for a colour AND a print on one fabric") was already overruled on 2026-08-20,
 * when the client put both cells on every part. This removes the last thing that
 * gate still did, which was to decide which of the two was allowed a list.
 */

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
  if (itemSubType === "melange")
    return { types: ["Melange"], sections: ["yarn", "fabric"] };
  // `yarn_dyed` HAD A BRANCH HERE (`{ types: ["Y/D"], sections: ["yarn"] }`)
  // and it is withdrawn by `componentColourEntry` below, not by an oversight.
  // Read that note before restoring it: a yarn-dyed part's colour is a BLEND
  // ("WHITE/BLUE STRIPE") and no single declared colour can state it.
  return null;
}

/**
 * HOW A PART'S COLOUR CELL IS ANSWERED — the one decision behind three
 * behaviours (client 2026-08-31).
 *
 *   "list"   the cell offers this order's declared colours and is REQUIRED
 *   "manual" the cell offers NOTHING, takes typed text, and is REQUIRED
 *   null     the cell offers nothing and is NOT required — the fabric has not
 *            said what kind of cloth it is yet, so there is nothing to answer
 *            from and a hold would cage the operator on an unanswerable cell.
 *
 * ## WHY THIS EXISTS AT ALL — the coupling it replaces
 *
 * `componentProblems` used to ask `colourSourceFor(...) !== null`, and the
 * comment beside it said so in capitals: "the list the cell OFFERS and the
 * requiredness of the cell are one decision", never a second reading of the
 * Fabric Type literals. That was right and Yarn Dyed breaks it — a yarn-dyed
 * part must still be REQUIRED to state its colour while being offered NO list
 * at all. Two independent tests would drift on the next change; one function
 * with three answers cannot.
 *
 * ## WHY YARN DYED IS "manual" (client 2026-08-31)
 *
 * "The system must exclude and hide the base fabric colors and the colors
 * selected in the Yarn Color field from appearing in the Component color list …
 * the field must be locked to manual-entry text input only."
 *
 * A yarn-dyed cloth is knitted from PRE-DYED yarns of several colours, so the
 * finished panel has no single solid colour — its colour is a description
 * ("WHITE/BLUE STRIPE"). The yarns themselves are named on the structure's own
 * **Yarn Color** field (`yarnColourOptions`), which is where those two colours
 * belong. Offering WHITE or BLUE on the part as well would let an operator
 * record a striped panel as plain WHITE, and the client's word for what that
 * does to the order's colourways is "corrupt".
 *
 * SO THE EXCLUSION IS TOTAL, AND THAT IS THE POINT. "Exclude the base fabric
 * colours and the yarn colours" removes both halves of everything this cell
 * could ever have offered — the declared palette IS those colours — so the
 * honest implementation is an empty list and a text box, not a filtered
 * dropdown that happens to come out empty. `declaredColoursFor` returns `[]`
 * here for exactly that reason.
 *
 * WHAT IS NOT A REASON TO WIDEN THIS: "the operator can still type anything".
 * True on every branch — the cell has always been free text — and it does not
 * make a wrong OFFER harmless. A list is a recommendation, and this one would
 * recommend the wrong answer.
 */
export type ComponentColourEntry = "list" | "manual" | null;

export function componentColourEntry(
  itemSubType: string | null | undefined,
): ComponentColourEntry {
  if (itemSubType === "yarn_dyed") return "manual";
  return colourSourceFor(itemSubType) ? "list" : null;
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

/* ------------------------------------------------------------------------- *
 * YARN COLOURS — the colours a yarn-dyed fabric is knitted FROM (0478)
 * ------------------------------------------------------------------------- */

/** A combo of this order, as the yarn-colour list reads it. */
export type ColourwayLike = {
  style_ref_no?: string | null;
  combo?: string | null;
};

/**
 * THE COLOURS OFFERABLE AS YARN COLOURS — client 2026-08-31:
 * "it must dynamically list ONLY the colors previously defined for the style's
 * master colorways (e.g. if the user set up White and Blue combos, only White
 * and Blue are selectable as yarn colors)."
 *
 * A combo IS a colourway, and on this order they are literally colour names —
 * WHITE, NAVY, GREY MELANGE, RED, GREEN, YELLOW, BLUE (catalog 2026-08-31). So
 * the source is the Combos grid itself, and that is not merely the cheapest
 * reading of the sentence: it is the ONLY source that cannot be empty where the
 * field appears. Yarn Color lives inside one combo's [Detail] overlay, so at
 * least one combo — the one being edited — always exists to offer.
 *
 * THE COLOR/PRINT PALETTE WAS THE OTHER CANDIDATE AND IT WOULD HAVE SHIPPED
 * DEAD. `declaredColoursFor(rows, "yarn_dyed")` read the yarn grid's `Y/D` rows,
 * and the catalog holds **no yarn-section dyeing row at all** — all seven
 * declared colours are `section = 'fabric'`. A Yarn Color dropdown sourced there
 * would have been empty on every live order on the day it shipped, which is the
 * `Y/D`-shaped hole `colourSourceFor` used to have and nobody noticed because
 * the cell also took free text.
 *
 * SCOPED TO THE COMBO'S OWN STYLE — "the STYLE's master colorways". A PO with
 * two styles has two independent sets of colourways, and offering style 2's
 * NAVY under style 1 is the cascading-filter defect one door along (AGENTS.md,
 * "Cascading filters"): the facet must narrow to the facet beside it.
 *
 * A COMBO NAMING NO STYLE IS OFFERED EVERYTHING, and this is the deliberate
 * OPPOSITE of the nominated-vendor "empty and explain". There a blank parent
 * means the answer is genuinely unapprovable; here it means an operator has not
 * typed a style ref onto a combo yet, and the colourways of the order are still
 * the right vocabulary. Same three clauses `scopedStructures` and
 * `declaredPrintOptions` already use on this screen: nothing to scope by falls
 * back to the whole list, never to nothing.
 *
 * ORDER IS FIRST-SEEN, NOT SORTED. The Combos grid is the operator's own list
 * and its order is the one they built; re-sorting it alphabetically would make
 * the dropdown disagree with the grid it came from.
 */
export function yarnColourOptions(
  combos: readonly ColourwayLike[],
  styleRefNo: string | null | undefined,
): string[] {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
  const want = norm(styleRefNo);
  const pick = (scoped: boolean) => {
    const out: string[] = [];
    for (const c of combos) {
      if (scoped && norm(c.style_ref_no) !== want) continue;
      const name = norm(c.combo);
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  };
  if (!want) return pick(false);
  const scoped = pick(true);
  // A style ref that matches no combo can only mean the grid has moved on
  // beneath this overlay; the order's colourways are still the vocabulary, and
  // an empty list here would read as "this style has no colours".
  return scoped.length ? scoped : pick(false);
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
 * IT ASKS `componentColourEntry`, NEVER THE LITERALS. The list the cell offers
 * and the requiredness of the cell are still one decision — re-testing
 * `=== "yarn_dyed"` here would compile, run, and drift the first time the
 * palette rule changed (which it has now done twice, on 2026-08-20 and again on
 * 2026-08-31).
 *
 * IT USED TO ASK `colourSourceFor` AND THAT IS NO LONGER THE SAME QUESTION.
 * A yarn-dyed fabric has no colour SOURCE — its parts are described by hand —
 * but it is still required to be described, so the test moved to the function
 * that answers all three states. Reverting it to `colourSourceFor(...) !== null`
 * silently makes Colour optional on every yarn-dyed part.
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
  if (componentColourEntry(itemSubType) && !(comp.color_name ?? "").trim()) {
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

/**
 * MULTI-COMBO FABRIC ANCHORING — the first filled colourway is the source of
 * truth for every colourway after it (client 2026-08-29).
 *
 * A PO in White, Green and Black is ONE fabric in three colours. The cloth's
 * Composition, GSM, Tolerance and Fabric Type are properties of the cloth, so
 * they are identical across the three by definition — and the operator was
 * retyping all four on every combo, on every structure, which is both the
 * keystrokes and the opportunity for the second combo to disagree with the
 * first about what the fabric IS.
 *
 * ## WHY THE FIRST COMBO AND NOT THE PREVIOUS ONE
 *
 * This is the client's own reasoning and it is the whole design: "if subsequent
 * combos fetched from the immediately preceding combo, any manual editing or
 * accidental data degradation in the second or third combo would propagate
 * onwards". Previous-combo chaining makes every combo a source, so one typo in
 * Green is inherited by Black and by everything after it, and the further down
 * the list you look the further the values have drifted. Anchoring on the first
 * gives every combo the same single parent — a drift can affect one row, never
 * a tail.
 *
 * That is the same argument `carryDownGsm` already makes one axis over ("FROM
 * THE FIRST FABRIC ONLY. Every card would otherwise be a source, and which one
 * had last been left would decide what the rest held"). This is that rule
 * between combos rather than between the structures of one.
 *
 * ## WHAT "THE FIRST FILLED COMBO" MEANS
 *
 * The first combo IN GRID ORDER that has answered any of the four on any
 * structure — not merely the first row, which on a fresh order is usually still
 * blank, and not "the most complete", which would make the source move as
 * editing continued. A combo that says nothing yet cannot be a source of truth
 * about anything.
 *
 * ## MATCHED ON `structure_id`, AND UNMATCHED MEANS NOTHING
 *
 * A combo holds several structures — a body, a rib, a collar — and they have
 * different GSMs. So the anchor is read PER FABRIC CATEGORY: the new combo's
 * SINGLE JERSEY inherits the anchor's SINGLE JERSEY and nothing else. A
 * structure the anchor does not carry inherits nothing and stays blank, which
 * is the only honest answer — copying "whatever the anchor's first row held"
 * would put a 200gsm jersey figure on a collar.
 *
 * A structure with no category cannot be matched at all and is skipped, rather
 * than being lumped under a `null` key where every unanswered structure of every
 * combo would collide.
 *
 * ## IT ONLY EVER FILLS A BLANK
 *
 * `defaultsFor` returns values; applying them is the caller's, and the caller
 * fills gaps rather than overwriting. That is the contract every other automatic
 * fill on this screen states — `pickComboStructure`'s "SEEDS, NEVER OVERWRITES",
 * `carryDownGsm`'s "BLANKS ONLY", the Style master's Type column — and it is
 * what lets a colourway legitimately differ: a Printed Black over a Solid White
 * is a real order, and an anchor that overwrote would make it unenterable.
 */
export type FabricAnchorLike = {
  structure_id: string | null;
  composition_id: string | null;
  gsm: string;
  gsm_tolerance: string;
  item_sub_type: string;
  fabric_type: string;
};

export type ComboAnchorLike<S extends FabricAnchorLike = FabricAnchorLike> = {
  key: string;
  structures: readonly S[];
};

/** The four the client named, plus `fabric_type` — which has no control on the
 *  card today but is stored, and would otherwise be the one property of the
 *  cloth that still differed between colourways. */
export type FabricDefaults = Pick<
  FabricAnchorLike,
  "composition_id" | "gsm" | "gsm_tolerance" | "item_sub_type" | "fabric_type"
>;

/** Has this structure answered any of the properties an anchor supplies? */
function saysAnything(s: FabricAnchorLike): boolean {
  return !!(
    s.composition_id ||
    s.gsm.trim() ||
    s.gsm_tolerance.trim() ||
    s.item_sub_type ||
    s.fabric_type
  );
}

/**
 * The anchor combo's fabric properties, keyed by fabric category.
 *
 * `exceptKey` is the combo being filled — a combo can never be its own anchor,
 * and without this the first combo would "inherit" from itself the moment it
 * became the first filled one, which is a no-op that reads as working and would
 * hide the fact that nothing was being copied.
 *
 * Returns an EMPTY map when there is no anchor yet, which is the ordinary state
 * on the first combo of a new order. The caller then seeds nothing extra and
 * the operator types the fabric once — which is exactly the intent: the first
 * combo is where the answer is given.
 */
export function fabricAnchorDefaults<S extends FabricAnchorLike>(
  combos: readonly ComboAnchorLike<S>[],
  exceptKey: string,
): Map<string, FabricDefaults> {
  const anchor = combos.find(
    (c) => c.key !== exceptKey && c.structures.some(saysAnything),
  );
  const out = new Map<string, FabricDefaults>();
  if (!anchor) return out;
  for (const s of anchor.structures) {
    if (!s.structure_id || out.has(s.structure_id) || !saysAnything(s)) continue;
    out.set(s.structure_id, {
      composition_id: s.composition_id,
      gsm: s.gsm,
      gsm_tolerance: s.gsm_tolerance,
      item_sub_type: s.item_sub_type,
      fabric_type: s.fabric_type,
    });
  }
  return out;
}

/**
 * One structure with the anchor's answers filled into its GAPS.
 *
 * Returns the row UNCHANGED — the same object — when there is nothing to add,
 * so a caller can rely on identity to avoid re-rendering a grid that did not
 * move, the way `carryDownGsm` already does.
 */
export function withFabricDefaults<S extends FabricAnchorLike>(
  s: S,
  defaults: Map<string, FabricDefaults>,
): S {
  if (!s.structure_id) return s;
  const d = defaults.get(s.structure_id);
  if (!d) return s;
  const patch: Partial<FabricAnchorLike> = {};
  if (!s.composition_id && d.composition_id) patch.composition_id = d.composition_id;
  if (!s.gsm.trim() && d.gsm.trim()) patch.gsm = d.gsm;
  if (!s.gsm_tolerance.trim() && d.gsm_tolerance.trim()) {
    patch.gsm_tolerance = d.gsm_tolerance;
  }
  if (!s.item_sub_type && d.item_sub_type) patch.item_sub_type = d.item_sub_type;
  if (!s.fabric_type && d.fabric_type) patch.fabric_type = d.fabric_type;
  return Object.keys(patch).length ? { ...s, ...patch } : s;
}
