/**
 * Orders ▸ Fabric BOM ▸ Components — the panel-to-fabric mapping rules (0495).
 *
 * The client's three association rules, stated 2026-09-01, in one module because
 * they are one question asked three ways: **which panels may this fabric be
 * mapped to?**
 *
 *   2. "The dropdown list of components must be filtered based on the fabric
 *      structure … when configuring a Single Jersey fabric, Neck is completely
 *      irrelevant and must be hidden."
 *   2b. "When a structured fabric like Rib is selected, its component should
 *      automatically default to Neck."
 *   3. "Once a component has been assigned to a fabric structure, it must be
 *      removed from the available selection list for subsequent Add Part
 *      actions on that style … If all parts of a style have already been
 *      mapped, the selection list should display as empty."
 *
 *
 * ## RULE 2 IS DATA, NOT A RULE, AND WRITING IT AS A RULE WOULD BE WRONG
 *
 * "Rib means Neck" is true of the tee in screenshot 2585 and false of the next
 * style that ribs a cuff. The association is already declared, per style, on the
 * order:
 *
 *     garment_order_amendment_style_components
 *       (style_ref_no, coordinate_id, component_id, fabric_category_id)
 *
 * — 0457's table, the order's own copy of what the Style master calls the
 * component-to-fabric mapping. `fabric_category_id` is a `categories` row, which
 * is the SAME thing `order_fabric_bom_lines.structure_id` holds (0409 moved
 * both), so the filter is a join and not a lookup table someone maintains.
 *
 * NECK IS NOT HIDDEN BY A RULE ABOUT NECKS. It is absent because this style
 * declares NECK against the 1X1 LYCRA RIB category and not against SINGLE
 * JERSEY. A style that declares it against both gets it in both lists, which is
 * correct and which a hard-coded rule could not express.
 *
 * The same join answers 2b for free: a filter returning exactly ONE panel is a
 * panel with nothing to choose, so it is filled in. That is this repo's
 * `soleFabricIn` / `compositionForStructure` shape — **derive only where the
 * answer is unambiguous**, never "take the first".
 *
 *
 * ## RULE 3'S SCOPE IS THE STYLE, AND THAT IS NOT THE HELPER WE ALREADY HAVE
 *
 * `componentsTakenUnder` (lib/orders/styles/rules.ts) excludes a panel already
 * spoken for UNDER ONE COORDINATE, on one grid. The client's rule here is wider:
 * across every fabric of the style. It has to be, or rule 4 cannot work —
 *
 *     "Map Front Body and Back Body to the Solid Single Jersey fabric. Click
 *      Add Fabric to select Melange Single Jersey. Map only the Sleeve
 *      component to this Melange Single Jersey fabric."
 *
 * — Sleeve is the only thing left to offer precisely BECAUSE Front and Back were
 * taken on a different fabric. A per-coordinate or per-fabric exclusion would
 * offer Front Body under the Melange too, and a garment panel cut from two
 * fabrics is not a thing.
 *
 * So it is its own function rather than a widened one. Widening
 * `componentsTakenUnder` would change what the Style(s) grid and the Combos
 * overlay both mean by "taken", which is a different and narrower claim on those
 * screens.
 *
 *
 * ## THE COLOURWAY AXIS MUST NOT COUNT AS "TAKEN"
 *
 * This is the trap, and it is invisible until there are two colourways.
 * `order_fabric_bom_lines` is one row per (style, colourway, structure, panel) —
 * so a WHITE tee and a BLACK tee of one style produce TWO lines naming FRONT
 * BODY, legitimately. An exclusion set built by walking the lines and adding
 * every `component_id` it sees would therefore report Front Body as taken while
 * the operator is still mapping it, and the second colourway's list would come
 * back empty on a garment nobody had finished.
 *
 * The set is of COMPONENT IDS, deduped — never of lines — and the caller passes
 * the row's own siblings, never the whole grid. Both halves matter and the
 * second is the one `componentsTakenUnder`'s doc already warns about: "a row
 * must never filter itself out of its own list."
 */

import { styleKey } from "@/lib/orders/amendments/style-key";

/**
 * Open or Tubular — legacy's "Type" on a colour row, and the client's Point 5
 * ("a specific, mandatory field on this tab").
 *
 * LOWERCASE VALUES, matching 0495's CHECK and every other text vocabulary on
 * this table. `open` is UNCHANGED — the label below is the only thing the
 * 2026-09-04 cleanup spec asked to rename ("rename the column selector 'Open'
 * to 'Open Width'"), and the CHECK constraint, every save payload and every
 * comparison against `l.fabric_form === "open"` all read the value, never the
 * label. Renaming the stored word too would be a migration, not a wording fix.
 *
 * STILL NOT `LAYOUT_TYPE_OPTIONS` BELOW, even though the two labels now read
 * identically ("Open Width" / "Tubular"). This is `fabric_form`
 * ('open'/'tubular'), the Components tab's own colourway-row field, entered
 * AFTER the panel's Component is already chosen; `LAYOUT_TYPE_OPTIONS` is
 * `layout_type`/`width_form` ('open_width'/'tubular'), the declared-per-style
 * fact 0527 built to GATE a Component picker on the Manual tab. Matching
 * words on screen does not make them one column — see 0527's own header for
 * why the two were kept spelled apart at the data layer.
 *
 * NOT `knit_type` (0490), which is Circular / Flat / Woven. That says how the
 * cloth is MADE; this says how the roll reaches cutting. A circular knit is the
 * one that can be either, which is exactly why both columns exist.
 */
export const FABRIC_FORM_OPTIONS = [
  { value: "open", label: "Open Width" },
  { value: "tubular", label: "Tubular" },
] as const;

export type FabricForm = (typeof FABRIC_FORM_OPTIONS)[number]["value"];

export const fabricFormLabel = (v: string | null | undefined): string =>
  FABRIC_FORM_OPTIONS.find((o) => o.value === v)?.label ?? "";

/**
 * The single distinct value among a group of lines, or "(mixed)".
 *
 * ABSTAINS RATHER THAN PICKING THE FIRST. A summary row stands for N lines, and
 * showing one line's fabric as though it were the group's would be a confident
 * lie on exactly the rows where the operator needs to look. Blank values are
 * ignored, so a half-filled group reads as its filled half rather than as
 * "(mixed)" against nothing.
 *
 * IT LIVES HERE BECAUSE IT HAS TWO READERS (2026-09-03). It was written for the
 * Components tab's panel row, which rolls up its colourways; the Fabric Process
 * tab's fabric row rolls up its lines' structure type and roll form the same
 * way. Two copies of a rule about abstaining is how two surfaces come to abstain
 * differently — and the difference would only ever show on the rows that
 * disagree, which are the rows the rule exists for.
 */
export function rollUp(values: readonly string[]): string {
  const seen = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (seen.length === 0) return "";
  return seen.length === 1 ? seen[0] : "(mixed)";
}

/**
 * Open Width or Tubular — the "Fab Rail" Layout Type (0527), the same two
 * words `order_fabric_bom_manual_entries.width_form` already uses. NOT
 * `FabricForm` above: that is `fabric_form` ('open'/'tubular'), the
 * Components tab's own colourway-row field, spelled differently on purpose —
 * see 0527's header. Comparing a Manual entry's `width_form` against a
 * declaration's `layout_type` needs no translation because both use this
 * spelling.
 */
export const LAYOUT_TYPE_OPTIONS = [
  { value: "open_width", label: "Open Width" },
  { value: "tubular", label: "Tubular" },
] as const;

export type LayoutType = (typeof LAYOUT_TYPE_OPTIONS)[number]["value"];

export const layoutTypeLabel = (v: string | null | undefined): string =>
  LAYOUT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "";

/**
 * One row of the order's own panel-to-fabric declaration
 * (`garment_order_amendment_style_components`, 0457).
 *
 * `fabric_category_id` is a `categories` row and is what a BOM line calls
 * `structure_id`. Named as the table names it, so a reader tracing the join is
 * not translating on the way.
 */
export type StyleComponentDecl = {
  style_ref_no: string | null;
  coordinate_id: string | null;
  component_id: string | null;
  fabric_category_id: string | null;
  /** Which Layout Type this part is normally cut in (0527), or null — see
   *  `componentsHiddenForLayout` (rule 4). Absent from `PanelOption`: it
   *  narrows the list, it is not part of a panel's identity, so it travels
   *  no further than rule 4. */
  layout_type?: string | null;
};

/** A BOM line, as far as these rules need to see it. */
export type MappedLineLike = {
  style_ref_no: string | null;
  structure_id: string | null;
  component_id: string | null;
};

/** One panel a fabric may be mapped to. */
export type PanelOption = {
  coordinate_id: string | null;
  component_id: string;
};

/**
 * RULE 2 — the panels this STYLE declares against this FABRIC CATEGORY.
 *
 * Deduped on (coordinate, component), because the order's own grid may name the
 * pair once per colourway and this list is offered once.
 *
 * AN EMPTY RESULT IS A REAL ANSWER and the caller must say so rather than fall
 * back to every component in the master. A style that has declared no panel
 * against this fabric is a style whose Components tab cannot be filled in yet,
 * and the fix is on Order Entry — "empty and explain, never a silent fallback"
 * (AGENTS.md, Nominated vendors). A fallback here would teach the operator that
 * the order's own mapping need not be filled in, which is the whole failure that
 * rule exists to prevent.
 */
export function declaredPanelsFor(
  decls: readonly StyleComponentDecl[],
  styleRefNo: string | null,
  structureId: string | null,
): PanelOption[] {
  if (!structureId) return [];
  const want = styleKey(styleRefNo);
  const seen = new Set<string>();
  const out: PanelOption[] = [];

  for (const d of decls) {
    if (!d.component_id) continue;
    if (d.fabric_category_id !== structureId) continue;
    /* A BLANK style on the DECLARATION cannot match: `styleKey` returns "" for
       an unnamed row and callers treat that as unkeyed, never as a style named
       "". A blank style on the LINE is the same — it means "every style" on the
       Fabric Lines grid, and "every style's panels" is not a set this rule can
       honestly produce. Both fall out of comparing the keys directly. */
    if (styleKey(d.style_ref_no) !== want) continue;

    const key = `${d.coordinate_id ?? ""}|${d.component_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ coordinate_id: d.coordinate_id, component_id: d.component_id });
  }
  return out;
}

/**
 * RULE 3 — the component ids already mapped anywhere in this style.
 *
 * SIBLINGS, NOT THE WHOLE GRID. The caller excludes the row being edited, for
 * the reason `componentsTakenUnder` states one module along: a row that filters
 * itself out of its own list renders filled-then-empty and blanks the FK on the
 * next save — the "Disabled rows" data loss, arriving through a dropdown.
 *
 * A SET OF COMPONENTS, NOT OF LINES. One panel is one row PER COLOURWAY, so the
 * same `component_id` legitimately appears many times; counting lines would make
 * a two-colourway order report every panel as taken twice over.
 */
export function panelsTakenInStyle(
  siblings: readonly MappedLineLike[],
  styleRefNo: string | null,
): Set<string> {
  const want = styleKey(styleRefNo);
  const taken = new Set<string>();
  for (const l of siblings) {
    if (!l.component_id) continue;
    if (styleKey(l.style_ref_no) !== want) continue;
    taken.add(l.component_id);
  }
  return taken;
}

/**
 * TODO(you) — the one decision this module leaves open, and the only place the
 * three rules meet.
 *
 * Compose `declaredPanelsFor` (rule 2) and `panelsTakenInStyle` (rule 3) into
 * the list a Component picker actually offers. Roughly:
 *
 *     const declared = declaredPanelsFor(decls, styleRefNo, structureId);
 *     const taken    = panelsTakenInStyle(siblings, styleRefNo);
 *     return declared.filter(...);
 *
 * Four real choices in those few lines:
 *
 *  · **THE HELD VALUE MUST SURVIVE, ALWAYS.** `held` is the component this row
 *    already names. It is by definition "taken" — by this very row — so a naive
 *    `!taken.has(id)` drops it, the cell renders empty over a real FK, and the
 *    next Save writes that emptiness. This is AGENTS.md's "Disabled rows" rule
 *    ("the one row that survives is the one the record already holds") arriving
 *    through rule 3 rather than through an inactive flag. Passing siblings
 *    rather than the whole grid is *half* the guard; keeping `held` is the other
 *    half, and the two protect against different mistakes — decide whether you
 *    want both belts or trust the caller.
 *
 *  · **AND IT MUST SURVIVE RULE 2 AS WELL.** A line mapped last week to a panel
 *    the order has since re-declared against a different fabric is not a line to
 *    silently blank — it is one to show, so somebody can look at it. Whether it
 *    is shown plainly or tagged (the `diaOptionsFor` shape in
 *    `fabric-bom-screen.tsx` appends `sublabel: "not declared"`) is your call:
 *    tagging is more honest, and it is one more branch.
 *
 *  · **THE COORDINATE DOES NOT NARROW IT.** `PanelOption` carries one, and the
 *    Combos overlay's `scopedComponents` does filter by it — but there the
 *    operator picks the Coordinate first and the Component second. Here they are
 *    mapping a PANEL to a fabric ("map only the Sleeve component to this Melange
 *    Single Jersey fabric"), and the coordinate is a fact ABOUT the panel that
 *    the declaration already carries. So every declared coordinate's panels are
 *    offered and the coordinate fills itself in FROM the chosen panel. That is
 *    one pick instead of two for an answer that was never ambiguous — the
 *    declaration pairs them.
 *
 *  · **EMPTY IS THE CALLER'S TO EXPLAIN.** The client asked for an empty list
 *    once everything is mapped, so empty is a SUCCESS state here — but it is
 *    indistinguishable from "the order declared nothing against this fabric",
 *    which is a problem to fix on Order Entry. Same shape of trap as the empty
 *    report under AGENTS.md's cascading-filter rule: the failure reads exactly
 *    like a legitimate result. This function does not try to encode the
 *    difference in its return value — `declaredPanelsFor(...).length === 0` is
 *    the test, it is one call the caller already has the arguments for, and a
 *    tagged union here would make every call site destructure a discriminator to
 *    reach a list.
 *
 * ## ITS SIBLING IS `takenComponentIds` IN `./manual.ts`, AND THEY ARE TWO
 *
 * The client stated one sentence — a panel belongs to exactly one thing — about
 * two different surfaces, and they resolve to different sets. Manual's is across
 * the BOM's manual ENTRIES, keyed by entry, because entries are its counting
 * unit and their sum is the garment. This one is across a STYLE's allocation
 * LINES, because a panel is cut from one cloth. Neither subsumes the other and
 * folding them would need a scope parameter that is really a second function.
 *
 * They must not drift on the part that IS shared, and that part is the
 * exclusion-of-self: both take the rows to compare against rather than the whole
 * grid, so a row can never filter itself out of its own list. Change one and
 * read the other.
 *
 * Contract: pure, total, never throws; the returned order is `declared`'s order,
 * which is the order's own `sno`.
 */
export function availablePanels(input: {
  decls: readonly StyleComponentDecl[];
  siblings: readonly MappedLineLike[];
  styleRefNo: string | null;
  structureId: string | null;
  held: string | null;
}): PanelOption[] {
  const declared = declaredPanelsFor(input.decls, input.styleRefNo, input.structureId);
  const taken = panelsTakenInStyle(input.siblings, input.styleRefNo);
  const held = input.held;

  const out = declared.filter((p) => p.component_id === held || !taken.has(p.component_id));

  /* THE HELD PANEL SURVIVES RULE 2 AS WELL, and this is the branch that is easy
     to leave out. `out` above only rescues it from rule 3. A line mapped last
     week to a panel the order has since re-declared against a DIFFERENT fabric
     falls out of `declared` entirely — so without this the cell renders empty
     over a real FK and the next Save writes that emptiness. That is AGENTS.md's
     "Disabled rows" data loss arriving through a cascading filter rather than
     through an inactive flag, and it is the same shape `diaOptionsFor` in
     fabric-bom-screen.tsx already guards one section along.

     APPENDED, NOT INSERTED IN ORDER, and untagged here: this module returns ids,
     and "not declared" is a LABEL. The caller that renders the option list owns
     the tag, the same way `diaOptionsFor` attaches its own `sublabel`. Keeping
     the survivor last is what makes it visible to a caller that wants to say so. */
  if (held && !out.some((p) => p.component_id === held)) {
    out.push({
      coordinate_id: input.decls.find((d) => d.component_id === held)?.coordinate_id ?? null,
      component_id: held,
    });
  }

  return out;
}

/**
 * RULE 4 — the component ids one Layout Type provably EXCLUDES, for Manual's
 * shape of picker (the whole `components` master, minus what's taken — see
 * `takenComponentIds` in ./manual.ts, this rule's sibling for the same
 * reason rule 3 and `takenComponentIds` are siblings).
 *
 * "The dropdown list of components must be filtered based on the Layout Type
 * … an Open Width row must not offer a component only ever cut Tubular."
 * Reads the SAME per-style declarations rules 2/2b/3 read
 * (`garment_order_amendment_style_components`), not a global property of the
 * `components` master — a style could conceivably declare a part differently
 * from another style, the same reason "Rib means Neck" is data and not code.
 *
 * A HIDE-LIST, NOT AN ALLOW-LIST, and that is what keeps this permissive by
 * construction (0527's migration header). Manual's picker offers every
 * master component regardless of this style's declarations today — this
 * rule only ever REMOVES from that list, and only a component this style has
 * declared AT LEAST ONCE, where EVERY declaration of it states the OTHER
 * Layout Type. A component with no declaration, or with even one declaration
 * carrying a null `layout_type`, is never hidden on a fact the style hasn't
 * stated — the same "restrict only in case X leaks through every state that
 * is not X" shape the nominated-vendor and cascading-filter rules already
 * state. `layoutType: null` (nothing chosen on the row yet) hides nothing.
 *
 * THE CALLER STILL OWNS HELD SURVIVAL. Unlike `availablePanels`, this
 * function does not know which component the caller's row already has
 * ticked — Manual's entries are a multi-select, not a single held value, so
 * "held" is a set the caller already has as `entry.component_ids`. Subtract
 * this hide-list AFTER keeping every already-ticked id, or an entry loaded
 * from a style whose declaration later narrowed would blank a saved answer.
 */
export function componentsHiddenForLayout(
  decls: readonly StyleComponentDecl[],
  styleRefNo: string | null,
  layoutType: LayoutType | null,
): Set<string> {
  const hidden = new Set<string>();
  if (!layoutType) return hidden;
  const want = styleKey(styleRefNo);
  const byComponent = new Map<string, (string | null | undefined)[]>();
  for (const d of decls) {
    if (!d.component_id) continue;
    if (styleKey(d.style_ref_no) !== want) continue;
    const list = byComponent.get(d.component_id) ?? [];
    list.push(d.layout_type);
    byComponent.set(d.component_id, list);
  }
  for (const [id, types] of byComponent) {
    /* EVERY declaration must be STATED and DISAGREE, or the component stays.
       A component declared under two coordinates — one saying `tubular`, one
       saying nothing — has a null among `types`, so `.every` fails and it is
       NOT hidden: exactly one undeclared coordinate is enough to make this
       style's answer "not yet said" rather than "no". Only when every
       declaration of this component names the OTHER layout does the style
       provably exclude it. */
    if (types.length > 0 && types.every((t) => t && t !== layoutType)) hidden.add(id);
  }
  return hidden;
}

/**
 * RULE 2b — the panel to fill in by itself, or null.
 *
 * "When a structured fabric like Rib is selected, its component should
 * automatically default to Neck."
 *
 * UNAMBIGUOUS ONLY, and that is the whole of it. Exactly one panel available
 * means there is nothing to choose and the operator would only be confirming it;
 * two or more means a guess, and a guessed FK reads on screen exactly like a
 * chosen one. This is `compositionForStructure`'s stated shape and
 * `soleFabricIn`'s before it.
 *
 * NULL MEANS "LEAVE THE CELL ALONE" — never "clear it". Overwriting a panel the
 * operator picked because the list has since grown is auto-populate turning into
 * data loss (`componentTypeForCategory` records the same rule in as many words).
 */
export function solePanel(available: readonly PanelOption[]): PanelOption | null {
  return available.length === 1 ? available[0] : null;
}

/**
 * THE FABRIC A [Detail] SHEET IS SCOPED TO — (style, structure, fabric).
 *
 * NOT the colourway. The client's Point 1 is that this tab must not re-ask what
 * earlier screens already know, and mapping FRONT BODY to a fabric is a fact
 * about the garment, not about the colour it is dyed — so asking it once per
 * colourway would be the duplicate entry they complained about, on the screen
 * they complained about it on.
 *
 * One group is therefore N lines (one per colourway), which is why "+ Add part"
 * writes N rows and why removing a panel removes N. That fan-out is the cost of
 * keeping `component_id` on the line, accepted deliberately (client 2026-09-01)
 * so that consumption stays per PANEL — a sleeve and a front body genuinely
 * consume different amounts of one cloth, and 0491's manual size rows hang off
 * that grain.
 *
 * A CONTROL CHARACTER JOINS THE PARTS, so a style ref containing the separator
 * cannot forge another group's key — the same reasoning, and the same character,
 * as `SEP` in `./requirement.ts`. Written as an ESCAPE, never as a raw byte: a
 * literal NUL makes git treat the file as binary, with no diff and no three-way
 * merge, and that has already happened to two screens in this repo.
 */
const SEP = "\u0000";

export function fabricGroupKey(l: {
  style_ref_no: string | null;
  structure_id: string | null;
  item_id: string | null;
}): string {
  return [styleKey(l.style_ref_no), l.structure_id ?? "", l.item_id ?? ""].join(SEP);
}
