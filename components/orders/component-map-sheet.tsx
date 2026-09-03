"use client";

/**
 * Orders ▸ Fabric BOM ▸ Components — the panel-mapping tree (0495).
 *
 * THIS FILE IS THE TREE AND NOTHING ELSE, as of 2026-09-02. It briefly also
 * exported a `ComponentMapSheet` that wrapped the tree in a Sheet and, for about
 * an hour, in a four-tab strip. Both are gone: the client scoped the [Detail]
 * popup to Yarn Dyed Details alone (screenshot 2623, "I said this components tab
 * from fab lines details — how still its appearing?"), which is also legacy's own
 * arrangement — legacy's [Detail] opens "Yarn Dyed Details" (2615) and Components
 * is a separate entry in its tab strip, which here is the rail section.
 *
 * So `ComponentMapBody` has ONE mount now: the Components rail section, one tree
 * per style. `YarnDyedSheet` in `yarn-dyed-panels.tsx` is the popup.
 *
 * The legacy screen's third tab (client screenshot 2585) is three nested grids:
 * style ▸ part ▸ assort colour. We do not need the outer two, because
 * `order_fabric_bom_lines` is already keyed on (style, colourway, structure,
 * panel) — one legacy leaf IS one of our lines. What is left to build is the
 * middle level, and this sheet is it.
 *
 *
 * ## WHY IT IS A SHEET AND NOT A FIFTH RAIL ROW
 *
 * The client asked for it by name (2026-09-01): "In earlier builds, navigating
 * to a completely separate page was highly disruptive. Implement this as an
 * optimized, responsive popup modal window rather than a full-screen redirect."
 * `Sheet` sizes to its content and keeps its own margins, so a fabric with one
 * panel is a short box and one with four grows — which is the "compact
 * initially, scales as more detail fields are added" they asked for, without a
 * height this file has to compute.
 *
 * It also passes the test 0492 failed. That tab wanted [Click]→Sheet and could
 * not have it, because its outer row was READ-ONLY and a sheet opened from a row
 * with no fields is a button Tab never reaches. Fabric Lines' rows are live
 * fields, so the [Detail] cell sits among them, `data-row-open` puts it on the
 * Tab path, and the keyboard contract is satisfied by the primitive.
 *
 *
 * ## ITS SCOPE IS (STYLE, STRUCTURE, FABRIC) — NOT THE COLOURWAY
 *
 * Mapping FRONT BODY to a cloth is a fact about the GARMENT, not about the
 * colour it is dyed. The client's first requirement for this tab is that it must
 * not re-ask what earlier screens know, so asking the mapping once per colourway
 * would be the duplicate entry they complained about, on the screen they
 * complained about it on.
 *
 * So one sheet covers N lines — one per colourway — and that fan-out is visible
 * rather than hidden: the panel row says how many colourways it covers, and the
 * colour rows beneath it are those lines. "+ Add part" writes N; removing a
 * panel removes N.
 *
 *
 * ## WHAT EACH LEVEL OWNS, AND WHY THE SPLIT IS WHERE IT IS
 *
 * A PANEL ROW owns what is true of the panel in every colour — its Component
 * (and the Coordinate that comes with it) and Open/Tubular. Writing one cell
 * there patches every line of the panel, which is the honest shape: a body knit
 * tubular is knit tubular in white and in black.
 *
 * A COLOUR ROW owns what genuinely varies — Required Colour, Required Print,
 * Specification. Those are per colourway by construction; the order declares a
 * different colour per combo and that is the whole point of a combo.
 *
 * Open/Tubular could have gone on the colour row and legacy draws it there. It
 * is here because the client called it a property of "the fabric for the
 * component", and because a cell repeated identically down four colour rows
 * invites three of them to be left blank while it holds the cursor (it is
 * mandatory) — four holds for one answer. CONFIRMED 2026-09-02, when the client
 * asked for legacy's field order everywhere else and was shown this one: it
 * stays on the panel row, and the colour row ECHOES it read-only so the layout
 * still reads like legacy's.
 *
 *
 * ## THREE LEVELS, AND THE SCOPE WIDENED TO THE STYLE (client 2026-09-02)
 *
 * The header above said "we do not need the outer two [levels], because
 * `order_fabric_bom_lines` is already keyed on (style, colourway, structure,
 * panel)". That was true of the DATA and wrong about the SCREEN, and legacy
 * screenshot 2613 is why: its four panel rows are FRONT BODY / BACK / LEFT
 * SLEEVE on SINGLE JERSEY and NECK on 1X1 LYCRA RIB — one tree, four panels,
 * two cloths. Scoped to a fabric, this sheet showed three of those four and the
 * operator opened it twice.
 *
 * So the sheet is now scoped to the STYLE (`detailLines` on the screen), and it
 * draws legacy's three levels:
 *
 *   1. STYLE     — Style Ref No · Style No · Article No, read-only.
 *   2. PANEL     — Coordinate · Component · Structure · Fabric Type · Fabric ·
 *                  GSM · Open/Tubular. Folds.
 *   3. COLOURWAY — Assort Colour · Fabric Type · Fabric · GSM · Type ·
 *                  Required Colour · Required Print · Specification.
 *
 * ## TWO OF LEGACY'S COLUMNS ARE DELIBERATELY ABSENT
 *
 * **Structure Type** (legacy prints "Circular" on every row) has no per-structure
 * source here. A structure is a `categories` row; the knit family is stored on
 * `order_fabric_bom_dias.knit_type`, which is a property of a DIA and not of the
 * structure. Deriving one from the other would be a guess printed as a fact.
 * Rendering the column empty is worse than leaving it out — that is the same
 * call the `Mixing Uom` cell got on 2026-09-02, in as many words: a column of
 * dashes in every row of every BOM. Say where it should come from and it is one
 * cell to add.
 *
 * **Conv. Item** stays the stub 0495 agreed with the client — a [Click] into a
 * screen no transcript describes. A button that opens nothing is a dead
 * affordance on the Tab path, so it is not drawn at all.
 *
 * ## LEVEL 3 REPEATS FABRIC AND GSM, AND THAT IS NOT REDUNDANCY HERE
 *
 * It looks like legacy noise and is not: `item_id` is a column of the LINE, and
 * a line is per colourway — so a white body and a navy body may legitimately
 * name two different fabric items. The panel row rolls them up and says
 * "(mixed)" when they disagree, which is the one honest summary; the colour rows
 * are where the actual value is. Same rule the Combos fold follows for its
 * aesthetics, and its note says why: "a fold that drops a stored value is worse
 * than a fold that is long".
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGrid } from "@/components/ui/field";
import { RecordPicker } from "@/components/masters/record-picker";
import { Truncated } from "@/components/ui/truncated";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  FABRIC_FORM_OPTIONS,
  availablePanels,
  solePanel,
  type StyleComponentDecl,
} from "@/lib/orders/fabric-bom/component-map";

/** What this sheet needs to see of a Fabric BOM line. The screen owns the rest. */
export type MapLine = {
  key: string;
  /** Which panel row this line belongs to while its component is still blank.
   *  See `LineRow.panel_uid` on the screen for why it exists. */
  panel_uid: string;
  style_ref_no: string;
  combo: string;
  structure_id: string | null;
  coordinate_id: string | null;
  component_id: string | null;
  item_id: string | null;
  color_name: string;
  fabric_form: string;
  required_print: string;
  specification: string;
};

export type PickerRow = {
  id: string;
  code: string | null;
  name: string;
  /**
   * NULLABLE, because the masters are. `FabricOption.inactive` is
   * `boolean | null | undefined` — a `boolean` here forced a coercion at the call
   * site, and coercing a flag is how a row's real state stops being the one the
   * picker reads. `RecordPicker` takes `Deactivatable`, which already understands
   * all three spellings the schema uses (AGENTS.md, "Disabled rows").
   */
  inactive?: boolean | null;
};

/**
 * What a line's cloth is CALLED — resolved by the screen, never here.
 *
 * Every one of these already has exactly one derivation on the Fabric BOM
 * screen: `structureName`, `descriptorFor(...).sub` and `.gsm`, and the fabric
 * master's own name. Re-deriving any of them in this sheet is how two surfaces
 * come to print different Fabric Types for one line — the failure AGENTS.md
 * records for `bomStatusTone` and this module records for `fabricGroupKey`. So
 * the sheet asks and does not compute.
 */
export type LineFacts = {
  structure: string;
  /** Legacy's `Structure Type` — "Circular Knit". A property of the STRUCTURE
   *  master (`categories.fabric_structure_id`), which is also where Order Entry
   *  ▸ Combos ▸ [Detail] derives its knit family from, so the two agree. */
  structureType: string;
  /** Solid · Melange · Yarn Dyed — the ORDER's `item_sub_type`, not the fabric
   *  master's `fabric_type`. Those are two columns and one of them was printed
   *  under the other's header once already (screenshot 2581). */
  fabricType: string;
  fabric: string;
  /** Legacy's printed range, "175 - 185" — a string, never a number. */
  gsm: string;
};

/**
 * The single distinct value among a panel's colourways, or "(mixed)".
 *
 * ABSTAINS RATHER THAN PICKING THE FIRST. A panel row is a summary of N lines,
 * and showing one colourway's fabric as though it were the panel's would be a
 * confident lie on exactly the panels where the operator needs to look. Blank
 * values are ignored, so a half-filled panel reads as its filled half rather
 * than as "(mixed)" against nothing.
 */
function rollUp(values: readonly string[]): string {
  const seen = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (seen.length === 0) return "";
  return seen.length === 1 ? seen[0] : "(mixed)";
}

/**
 * A READ-ONLY CELL OF THE CLOTH — Structure, Fabric Type, Fabric, Gsm, Type.
 *
 * NO `<Field>` WRAPPER SINCE BOTH LEVELS BECAME TABLES (client 2026-09-02). It
 * was `ClothCell`, which drew its own `Field` label — right inside a `FieldGrid`,
 * where every cell carries its own heading, and wrong in a table, where the
 * column header is the heading and a second one inside the cell would print the
 * name twice per row.
 *
 * PLAIN TEXT, NEVER A DISABLED `<Input>`. A greyed box says "you may edit this
 * once something else is true"; these are edited on Fabric Lines and never here,
 * and a box the operator can click into and not change is the affordance that
 * makes them try. It also keeps them off the Tab path with no `tabIndex` to set
 * — a read-only value is not a field (AGENTS.md, "Tab lands on fields").
 *
 * `<Truncated>` because a fabric name is legacy's longest cell by far
 * (`SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%`), and
 * an ellipsis with no way to read the rest is a dead end (AGENTS.md,
 * "Truncated values").
 */
function ClothText({ value }: { value: string }) {
  return (
    <div className="flex min-h-8 items-center">
      <Truncated className="text-sm text-muted-foreground">{value || "—"}</Truncated>
    </div>
  );
}

/** One panel of the fabric, with the lines (one per colourway) that carry it. */
type PanelGroup = {
  /** The panel's own key — its component id, or a placeholder for an unmapped row. */
  key: string;
  component_id: string | null;
  coordinate_id: string | null;
  fabric_form: string;
  /** THE PANEL'S OWN STRUCTURE (2026-09-02). It was the sheet's, when the sheet
   *  covered one fabric; now that it covers a style, `availablePanels` has to be
   *  asked per panel or a rib neck would be offered the jersey's panel list. */
  structure_id: string | null;
  lines: MapLine[];
};

/**
 * THE TREE ITSELF, WITHOUT A SURFACE AROUND IT (client 2026-09-02: "the
 * component tab is missing from ui add it after the fabric lines tab").
 *
 * IT IS ONE IMPLEMENTATION WITH TWO MOUNTS, and that is the whole reason this
 * split exists rather than a second tree on the rail. The [Detail] popup and the
 * Components section show the same three levels of the same lines; drawing them
 * twice is what `bom-queue.tsx` records for the two BOM queues — "the drawing
 * was the only half hand-rolled twice and so the only half that drifted".
 *
 * It renders no heading and no box: the popup supplies a `Sheet`, the rail row
 * supplies a `SectionBody`, and neither wants the other's chrome.
 */
export function ComponentMapBody({
  lines,
  decls,
  components,
  coordinates,
  /** The order's declared colours and prints, for the two auto-filled cells. */
  colourOptions,
  printOptions,
  /** The order's assort colourways — this sheet is now the only door to them. */
  comboOptions,
  structureId,
  styleRefNo,
  /** Style No and Article No — legacy's top level. Null when the order does not
   *  name this style ref, which prints as a dash rather than as a blank row. */
  styleIdentity,
  /** What a line's cloth is called. Resolved by the screen — see `LineFacts`. */
  factsFor,
  /** The cloths this BOM plans — see the prop's type for why it is not the
   *  master. */
  fabricOptions,
  /** One fabric's Solid / Melange / Yarn Dyed, from the MASTER. See the type. */
  fabricTypeOfId,
  fabricStructureOfId,
  fabricTypeOptions,
  onAddFabric,
  /** Every line of the BOM, so rule 3 can see panels taken on OTHER fabrics. */
  allLines,
  onPatchPanel,
  onPatchLine,
  onAddPanel,
  onRemovePanel,
}: {
  lines: MapLine[];
  decls: readonly StyleComponentDecl[];
  components: readonly PickerRow[];
  coordinates: readonly PickerRow[];
  colourOptions: readonly string[];
  printOptions: readonly string[];
  comboOptions: readonly string[];
  structureId: string | null;
  styleRefNo: string;
  styleIdentity: { ref: string; style: string; article: string } | null;
  factsFor: (line: MapLine) => LineFacts;
  /**
   * THE FABRIC PICKER'S OPTIONS — THE FABRIC MASTER, narrowed per row by
   * `fabricStructureOfId` below (client 2026-09-02, said three times, last as
   * "Structure — that structure based on fabrics will list fabric field").
   *
   * ## IT WAS THIS BOM'S OWN FABRIC LINES, AND THAT IS REVERSED
   *
   * The earlier instruction was "Fabric from previous tab fabric line", and the
   * reasoning held while Components mapped panels onto lines a planner had
   * already created on Fabric Lines: a panel naming cloth with no fabric line
   * behind it would carry no consumption, no route and no requirement.
   *
   * Since the order SEEDS the lines, Components rows ARE fabric lines. There is
   * no earlier tab that has named a cloth first, so the derived list was empty on
   * every seeded BOM and this picker offered nothing (screenshot 2643) — and it
   * was self-referential besides: the only way a cloth entered that list was
   * being picked, and the only control that picked it was fed by that list.
   *
   * The old rule is not lost, it is satisfied differently. Picking here IS
   * naming the cloth on this line, and the line is a fabric line — so a panel
   * still cannot point at cloth the BOM does not plan.
   *
   * A HELD FABRIC THE MASTER NO LONGER LISTS IS STILL OFFERED, tagged inactive:
   * the same "Disabled rows" rule the Component picker beside it follows, or a
   * fabric deleted from the master would render a filled cell empty and blank
   * the FK on the next save.
   */
  fabricOptions: readonly PickerRow[];
  /**
   * "+ Add" on a Fabric cell, handed the row's STRUCTURE and the picker's own
   * `commit`. Optional: with no permission to create, or no FABRIC item class to
   * create under, there is no Add affordance at all rather than one whose Save
   * the server will refuse.
   *
   * The screen owns the sheet, not this file — it is mounted at the editor root
   * so `ChildGrid`'s `RequiredScope` cannot leak "required" into every optional
   * field inside it (the New Yarn / Purity defect, 2026-08-06).
   */
  onAddFabric?: (structureId: string, commit: (id: string) => void) => void;
  /**
   * A FABRIC'S STRUCTURE — `items.category_id`, which is what a Structure IS on
   * this screen (0405 · 0415) — so a panel offers only cloth of its own
   * structure (client 2026-09-02, "the first structure field based fabric only
   * need to list in that fabric field").
   *
   * NARROWS `fabricOptions`, NEVER REPLACES IT. The list is still this BOM's own
   * fabric lines, which is the client's own earlier instruction ("Fabric from
   * previous tab fabric line") and is unchanged — this only removes the rows
   * that could never be right, the same narrowing `fabricItemsFor` applies on
   * the Fabric Lines grid one tab over.
   *
   * A FUNCTION AND NOT A COLUMN ON THE ROW, exactly like `fabricTypeOfId` beside
   * it: the answer lives on the fabric MASTER, and a copy carried on the option
   * row would be a second place for it to disagree with `items`.
   */
  fabricStructureOfId: (itemId: string | null) => string | null;
  /**
   * THE FABRIC TYPE VOCABULARY — `config_lookups` kind `fabric_type`, as NAMES.
   *
   * Names and not ids, because that is what `fabricTypeOfId` returns and what
   * the cell compares against: an id here would need a second resolution on
   * every row to answer "is this the type the operator narrowed to". The screen
   * already loads this list for the Fabric picker's own quick-create sheet, so
   * it costs no query.
   */
  fabricTypeOptions: readonly string[];
  /**
   * A FABRIC'S TYPE — Solid | Melange | Yarn Dyed — READ FROM THE MASTER, never
   * stored per line (client 2026-09-02, asked before wiring).
   *
   * ## THE DROPDOWN FILTERS; IT DOES NOT WRITE
   *
   * Since 0513 this word is not a label. It decides whether Mixing UOM and No Of
   * Colors are mandatory on a line, and whether [Detail] opens Yarn Dyed Details
   * — and `missingFabricLineFields` and BOTH server actions resolve it from
   * `items` themselves. A cell that stored its own answer would give a Save gate
   * two sources: a line claiming Solid over a YARN DYED cloth would drop the
   * mandatory rule with nothing on screen to say why, and the screen and the
   * action would disagree about whether the document can be saved. That failure
   * is silent, which is what rules it out.
   *
   * So the cell narrows the Fabric picker beside it and the fabric still decides
   * the type — picking a cloth IS how the type changes. `fabricTypeOf` on the
   * screen is the one derivation, shared with `factsFor` and with the Fabric
   * Lines grid, so all three cannot disagree.
   */
  fabricTypeOfId: (itemId: string | null) => string;
  allLines: readonly MapLine[];
  /** Patch every line of one panel — Component / Coordinate / Open-Tubular. */
  onPatchPanel: (panelKey: string, patch: Partial<MapLine>) => void;
  /** Patch one colourway's line — Required Colour / Print / Specification. */
  onPatchLine: (lineKey: string, patch: Partial<MapLine>) => void;
  /** Adds one panel. The sheet passes the auto-default where there is one —
   *  see the `solePanel` call at the button. */
  onAddPanel: (seed: { component_id: string | null; coordinate_id: string | null }) => void;
  onRemovePanel: (panelKey: string) => void;
}) {
  /**
   * The fabric's lines, gathered into panels.
   *
   * KEYED ON THE COMPONENT, falling back to `panel_uid` while a panel is still
   * blank. Both halves are load-bearing: keying blanks on the LINE would draw
   * one "+ Add part" as one row per colourway, and keying every blank together
   * would merge two Adds into one so the second looked like it did nothing.
   */
  /**
   * WHICH PANEL'S SPLIT IS OPEN — Combos ▸ Structure Details' accordion, reused
   * rather than reinvented (client 2026-09-02: "that colourways make it autoclose
   * and enable feature ... already we previously done it order entry, take
   * reference from there").
   *
   * ## THE ROW IS THE AFFORDANCE. THERE IS NO TOGGLE.
   *
   * That is what `child-grid.tsx` does for `foldRows`, and it is why the ⊞ box
   * had to go: Order Entry has no such control. A row opens by being FOCUSED or
   * CLICKED, so the fields the operator is already heading for are the way in,
   * and nothing extra sits in the typing path. It also means the colourways can
   * never become mouse-only — the panel row's own Component picker and
   * Open/Tubular select are ordinary Tab stops, and arriving at either opens the
   * split beneath before the operator reaches it.
   *
   * ## `null` IS "EVERYTHING SHUT", AND THAT IS THE MOUNT STATE
   *
   * The client's module-wide rule from 2026-08-19: "instead of open one section
   * the sections should be in closed state, because it's making confusion for the
   * user". A four-panel style opening with one expanded cannot say whether that
   * is a selection, a default, or the only one there is.
   *
   * ## ANY ROW CLAIMS IT, NOT JUST A SHUT ONE
   *
   * Copied deliberately from the grid, comment and all, because the obvious
   * version is the bug it records: gating the handler on "is this row folded"
   * leaves a row that is ALREADY open without one, and then focusing a second row
   * never displaces the first — two splits open at once, which is the state "one
   * at a time" exists to prevent, appearing exactly when the operator starts the
   * second panel.
   *
   * The functional update is what keeps it free: re-focusing inside the row
   * already open returns the same key, so React bails out instead of re-rendering
   * on every Tab within a row.
   */

  const panels: PanelGroup[] = useMemo(() => {
    const out: PanelGroup[] = [];
    const byKey = new Map<string, PanelGroup>();
    for (const l of lines) {
      /* THE COMPONENT WHERE THERE IS ONE, the shared uid where there is not —
         see `panel_uid`. Preferring the component means a panel keeps its
         identity across a reload, where the uid is regenerated. */
      const key = l.component_id ?? l.panel_uid;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          component_id: l.component_id,
          coordinate_id: l.coordinate_id,
          fabric_form: l.fabric_form,
          /* THE FIRST LINE'S STRUCTURE IS THE PANEL'S. Every colourway of one
             panel is cut from one cloth — that is what makes a panel a panel —
             so there is nothing to roll up here, unlike `item_id` below. */
          structure_id: l.structure_id,
          lines: [],
        };
        byKey.set(key, g);
        out.push(g);
      }
      g.lines.push(l);
    }
    return out;
  }, [lines]);

  /* NO `declaredCount` ANY MORE (client 2026-09-02: "remove it also no need
     this sentence"). It counted `declaredPanelsFor` for one reader — the warning
     line above the tree — and had no other.

     WHAT GOES WITH IT IS WORTH NAMING. That line was the "empty and explain" half
     of a real distinction: an empty Component dropdown means either every panel
     is already mapped (fine) or the ORDER declares no panel against this fabric
     (a problem to fix on Order Entry), and the two look identical. AGENTS.md
     files that under cascading filters — "the failure is indistinguishable from a
     legitimate result, so it gets believed rather than reported". The client has
     seen the sentence and does not want it; `declaredPanelsFor` is untouched and
     still exported, so restoring it is one `useMemo` and one paragraph. */

  const componentName = (id: string | null) =>
    components.find((c) => c.id === id)?.name ?? null;
  const coordinateName = (id: string | null) =>
    coordinates.find((c) => c.id === id)?.name ?? null;

  /* THE COMPONENTS TREE AND NOTHING ELSE.
     
     NO TAB STRIP, AND NO SHEET — this file draws the tree and stops (client
     2026-09-02, screenshots 2619 → 2620 → 2623). It took two corrections to get
     here and both are worth keeping, because each was a plausible arrangement:

       1. The four-tab strip was put INSIDE this body. Wrong because the body was
          then mounted twice — the [Detail] popup and the Components rail section
          — so Yarn Dyed Details, which is a fact about one fabric LINE, grew tabs
          on a rail section that has no line to be about.
       2. The strip moved to a `ComponentMapSheet` wrapper here, still carrying a
          Components tab. Wrong because the client's instruction was that the
          popup holds ONLY the three yarn tabs: "I said this components tab from
          fab lines details — how still its appearing?"

     THE SECOND CORRECTION IS ALSO WHAT LEGACY DOES. Legacy's [Detail] opens a
     window titled "Yarn Dyed Details" (screenshot 2615); Components is a separate
     entry in its tab strip, which in this app is the rail section. Two surfaces,
     legacy's two — and the Components tab in the popup was a third copy of
     something that already had a home.

     So `ComponentMapBody` has ONE mount, the rail section, and the popup is
     `YarnDyedSheet` in yarn-dyed-panels.tsx. Before putting a feature in a shared
     body, count its mounts. */
  /**
   * THE FABRIC PICKER'S ROWS, with the held value guaranteed to survive.
   *
   * `fabricOptions` is this BOM's own fabric lines, so a cloth removed from
   * Fabric Lines leaves the list while a Components panel may still hold it.
   * Dropping it would render a filled cell empty and blank the FK on the next
   * save — the data loss AGENTS.md's "Disabled rows" rule exists to prevent,
   * arriving through a missing row rather than a switched-off one. So a held id
   * the list no longer carries is appended, tagged, and cannot be re-picked.
   */
  /**
   * WHICH FABRIC TYPE EACH ROW'S PICKER IS NARROWED TO — a view, not a value.
   *
   * Keyed by panel key or line key, and deliberately NOT stored: nothing here
   * reaches the payload. An empty entry means "no narrowing", which is also what
   * a row starts at.
   */
  const [typeFilter, setTypeFilter] = useState<Record<string, string>>({});

  /**
   * THE FABRIC TYPE MASTER, NOT THE TYPES ALREADY ON THIS BOM (client
   * 2026-09-02, screenshot 2643: "Fabric Type — solid, yarn dyed, printed,
   * melange", pointing at a dropdown that read **"No matches."**).
   *
   * It was `new Set(fabricOptions.map(fabricTypeOfId))` — the types the cloths on
   * this BOM come in — reasoned as "never the whole vocabulary, so the list
   * cannot offer a narrowing that matches nothing". The reasoning is sound about
   * a filter and wrong about this screen, because `fabricOptions` is this BOM's
   * own fabric LINES: on a BOM where no line names a cloth yet, which is every
   * BOM the moment it is seeded from the order, the set is EMPTY and the cell
   * offers nothing at all.
   *
   * So it traded a narrowing that returns nothing — visible, and undone by
   * clearing the cell — for a control that is dead on arrival. The client read
   * the dead one as the list being wrong, which is exactly what it looks like.
   *
   * `fabricTypeOptions` comes from `config_lookups` kind `fabric_type` and so
   * follows the master: 0515's `Printed` appeared here without this file
   * changing, and a fifth value will too.
   */
  const fabricTypes = fabricTypeOptions;

  /** The Fabric Type cell: shows the CLOTH's type until the operator narrows. */
  const typeCell = (key: string, heldItemId: string | null) => (
    <Select
      compact
      className="h-8"
      value={typeFilter[key] ?? fabricTypeOfId(heldItemId)}
      onChange={(e) => setTypeFilter((f) => ({ ...f, [key]: e.target.value }))}
    >
      <option value="" />
      {fabricTypes.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );

  /** Clearing the narrowing when a fabric is chosen is what keeps the cell
   *  TRUTHFUL: the type shown then falls back to the cloth's own. */
  const clearFilter = (key: string) =>
    setTypeFilter((f) => {
      if (!(key in f)) return f;
      const next = { ...f };
      delete next[key];
      return next;
    });

  const fabricItems = (held: string | null): PickerRow[] => {
    const rows = [...fabricOptions];
    if (held && !rows.some((r) => r.id === held)) {
      /* THE TAG NAMES THE NEW SOURCE. It read "(no longer a fabric line on this
         BOM)" while the options were the BOM's own lines; against the master,
         an id the list does not carry is a fabric that has been deleted, and a
         label describing the old source would send the operator to look for it
         on the wrong screen. */
      rows.push({
        id: held,
        code: null,
        name: "(fabric no longer in the master)",
        inactive: true,
      });
    }
    return rows;
  };

  /**
   * The picker's rows, narrowed TWICE — by the panel's own structure, and then
   * by the row's Fabric Type cell.
   *
   * THE STRUCTURE NARROWING IS THE ROW'S OWN AND IS NOT A FILTER THE OPERATOR
   * SET (client 2026-09-02). A panel of 1X1 LYCRA RIB cannot be cut from a
   * single jersey, so offering one is offering a mapping that can never be
   * right — the same narrowing the Fabric Lines grid applies one tab over.
   * Skipped where the row names no structure, because there is then nothing to
   * scope BY and a mandatory cell narrowed to nothing has no way out.
   *
   * A HELD VALUE ALWAYS SURVIVES BOTH — same rule as the inactive tag above and
   * for the same reason: a filter must never blank a cell that is already
   * filled, or the next save writes that emptiness over a real FK.
   */
  const fabricItemsFor = (
    key: string,
    held: string | null,
    structureId: string | null,
  ): PickerRow[] => {
    const want = typeFilter[key];
    let rows = fabricItems(held);
    if (structureId) {
      rows = rows.filter((r) => r.id === held || fabricStructureOfId(r.id) === structureId);
    }
    return want ? rows.filter((r) => r.id === held || fabricTypeOfId(r.id) === want) : rows;
  };

  /**
   * LEVEL 2's COLUMNS — legacy's order exactly (client 2026-09-02, screenshot
   * 2613), minus the two the client answered "leave it out" for.
   *
   *   S No · Coordinate · Component · Structure · Fabric Type · Fabric · Gsm
   *
   * `S No` is `ChildGrid`'s own `#`, so it is not declared here.
   *
   * COORDINATE BEFORE COMPONENT, which reverses what this sheet shipped with.
   * Legacy scans that way and the operators are migrating from it.
   */
  const panelColumns: ChildGridColumn<PanelGroup>[] = [
    {
      /* COORDINATE IS SHOWN AND NOT EDITED. Legacy prints it and it is real
         information — PIECES vs TOP tells two identically-named panels apart —
         but it is a property OF the chosen component, so an editable box would be
         a second place for it to disagree with the order. Read-only TEXT rather
         than `<Input readOnly>`: nothing is typed, so nothing should be a tab
         stop. */
      header: "Coordinate",
      width: "7rem",
      cell: (p) => (
        <Truncated className="text-sm text-muted-foreground">
          {coordinateName(p.coordinate_id) ?? "—"}
        </Truncated>
      ),
    },
    {
      header: "Component",
      required: true,
      width: "11rem",
      cell: (p) => {
        /* RULE 2 + RULE 3, THROUGH THE ONE FUNCTION. Siblings are the OTHER
           panels of the whole BOM — never this one — so a panel can never filter
           itself out of its own list. */
        const options = availablePanels({
          decls,
          siblings: allLines.filter((l) => !p.lines.some((x) => x.key === l.key)),
          styleRefNo,
          /* THE PANEL'S OWN STRUCTURE, falling back to the sheet's for a panel
             that has not been given one yet. Passing one sheet-wide structure was
             correct while this covered ONE fabric; scoped to a style it would
             offer the jersey's panel list against a rib neck. */
          structureId: p.structure_id ?? structureId,
          held: p.component_id,
        });
        /* THE MASTER'S OWN ROWS, NARROWED — never rows rebuilt from the ids.
           `getComponentRows` already resolved `inactive` off the `components`
           table, and reconstructing a row here would hand `RecordPicker` a fresh
           object whose flag was whatever this file remembered to copy
           (`--check picker-inactive` catches exactly that).

           A PANEL THE MASTER NO LONGER HAS IS STILL SHOWN, tagged inactive. It
           can only be one this line already HOLDS, so "Disabled rows" applies
           word for word: it stays on the field, greyed, and cannot be re-picked.
           Dropping it would render a filled cell empty and blank the FK on the
           next save. */
        const items: PickerRow[] = options.map(
          (o) =>
            components.find((c) => c.id === o.component_id) ?? {
              id: o.component_id,
              code: null,
              name: "(panel no longer in the master)",
              inactive: true,
            },
        );
        return (
          <RecordPicker
            label="Component"
            compact
            required
            items={items}
            value={p.component_id}
            onChange={(id) =>
              onPatchPanel(p.key, {
                component_id: id,
                /* THE COORDINATE COMES WITH THE PANEL and is never picked
                   separately. The order's declaration pairs them, so asking twice
                   is asking the operator to restate something they have already
                   said — and to get it wrong. */
                coordinate_id:
                  options.find((o) => o.component_id === id)?.coordinate_id ?? null,
              })
            }
          />
        );
      },
    },
    /* THE CLOTH, READ-ONLY — legacy's `Structure | Fabric Type | Fabric | Gsm`.
       SHOWN HERE, EDITED ON FABRIC LINES: those are cells of that grid, which is
       legacy's FabricAllocation tab, and a second editor for them would be two
       places for one line to be changed from. `(mixed)` is a real answer, not a
       placeholder — see `rollUp`. */
    {
      header: "Structure",
      width: "9rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).structure))} />,
    },
    {
      /* LEGACY'S `Structure Type` — "Circular" — restored 2026-09-02 after being
         left out for want of a source. It has one: `categories.fabric_structure_id`,
         the structure master's own knit family, which is also what Order Entry ▸
         Combos ▸ [Detail] derives its family chip from. The earlier search
         stopped at `order_fabric_bom_dias.knit_type` (a property of a DIA) and at
         `combo_structures.fabric_type` (NULL on all 33 live rows) and concluded
         wrongly. */
      header: "Structure Type",
      width: "7rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).structureType))} />,
    },
    {
      /* A DROPDOWN THAT NARROWS THE FABRIC CELL BESIDE IT (client 2026-09-02),
         not a stored value — see `fabricTypeOfId` for why storing it would give a
         Save gate two answers. */
      header: "Fabric Type",
      width: "7rem",
      cell: (p) => typeCell(p.key, rollUp(p.lines.map((l) => l.item_id ?? "")) || null),
    },
    {
      /* USER ENTRY, WIRED TO THE CLOTH THIS BOM PLANS (client 2026-09-02:
         "Fabric field is user entry, connect the fabric master data with that
         field" / "Fabric from previous tab fabric line"). It was read-only text
         rolled up from the colourways.

         PICKING HERE WRITES EVERY COLOURWAY OF THE PANEL, which is what
         `onPatchPanel` does and what the client chose over the alternatives: a
         panel is one part of one garment, so its cloth is normally one cloth, and
         the colour row below can still override a single colourway where a white
         body and a navy body genuinely differ. Same write-through Open/Tubular
         had on this row before it moved down.

         THE ROLL-UP SURVIVES AS THE VALUE. `rollUp` returns the single distinct
         item id or nothing, so a panel whose colourways name two cloths shows the
         picker EMPTY rather than picking one of them to display — an abstain, not
         a guess, and typing into it then sets both. */
      header: "Fabric",
      width: "16rem",
      cell: (p) => (
        <RecordPicker
          label="Fabric"
          compact
          items={fabricItemsFor(
            p.key,
            rollUp(p.lines.map((l) => l.item_id ?? "")) || null,
            p.structure_id,
          )}
          /* WHERE THE STRUCTURE HAS NO CLOTH YET, SAY SO. A narrowed-to-empty
             list is otherwise indistinguishable from a broken dropdown — the
             failure this picker shipped with (screenshot 2643). */
          emptyHint={
            p.structure_id
              ? "No fabric is filed under this structure yet — use + Add to create one."
              : null
          }
          /* "+ Add" UNDER THIS PANEL'S STRUCTURE — the same sheet the Fabric
             Lines cell opens, so the field behaves identically on both tabs.
             Offered only where the row names a structure to file the cloth
             under; the screen decides the permission half. */
          onAddOverride={
            onAddFabric && p.structure_id
              ? (commit) => onAddFabric(p.structure_id as string, commit)
              : undefined
          }
          value={rollUp(p.lines.map((l) => l.item_id ?? "")) || null}
          onChange={(id) => {
            onPatchPanel(p.key, { item_id: id });
            clearFilter(p.key);
          }}
        />
      ),
    },
    {
      header: "Gsm",
      align: "right",
      width: "5rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).gsm))} />,
    },
    /* NO `Open / Tubular` HERE ANY MORE (client 2026-09-02: "no more
       Open / Tubular tab — to colourways panel"). It has moved to the colour
       row's `Type`, which is where legacy draws it and which the colour row was
       already echoing read-only.

       THIS REVERSES 2026-09-02's OWN EARLIER ANSWER, deliberately. When the field
       order was matched to legacy the client was asked about this exact cell and
       chose to keep it here, on the argument that a mandatory cell repeated down
       four colourways is four holds for one answer. They have now seen it and
       decided the other way; the later instruction wins. What that argument
       predicted is real and is the thing to watch — see the `Type` column. */
  ];

  /**
   * LEVEL 3's COLUMNS — legacy's order (screenshot 2613), minus `Conv. Item`.
   *
   *   S No · Assort Color · Fabric Type · Fabric · Gsm · Type ·
   *   Required Color · Required Print · Specification
   *
   * FABRIC TYPE / FABRIC / GSM ARE REPEATED FROM THE PANEL ROW AND ARE NOT
   * REDUNDANT. `item_id` is a column of the LINE, and a line is per colourway, so
   * a white body and a navy body may name two different fabric items — the panel
   * row rolls them up and says "(mixed)", and these are where the values are.
   *
   * Widths: 8 + 6 + 12 + 5 + 6 + 9 + 9 + 10 = 65rem ≈ 1040px, inside the wide
   * section's row even after the 1rem indent.
   */
  const colourColumns: ChildGridColumn<MapLine>[] = [
    {
      /* A `Select`, not a Combobox: the order's colourways are a closed list and a
         fifth spelling of NAVY here would split the fan-out `addPanel` builds.
         Blank is a real answer — `fabricSlices` reads it as "every colourway".

         THE STYLE RIDES WITH IT (`onPatchLine` applies `styleForCombo`), written
         on the CHANGE and never in an effect — an effect would rewrite every
         stored line's style when a saved BOM is opened. */
      header: "Assort Color",
      width: "8rem",
      cell: (l) => (
        <Select
          compact
          className="h-8"
          value={l.combo}
          onChange={(e) => onPatchLine(l.key, { combo: e.target.value })}
        >
          <option value="" />
          {comboOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Fabric Type",
      width: "7rem",
      cell: (l) => typeCell(l.key, l.item_id),
    },
    {
      /* THE PER-COLOURWAY OVERRIDE. `item_id` is a column of the LINE, so a white
         body and a navy body may legitimately name two cloths; the panel row
         above writes every colourway at once and this changes one. */
      header: "Fabric",
      width: "12rem",
      cell: (l) => (
        <RecordPicker
          label="Fabric"
          compact
          items={fabricItemsFor(l.key, l.item_id, l.structure_id)}
          emptyHint={
            l.structure_id
              ? "No fabric is filed under this structure yet — use + Add to create one."
              : null
          }
          onAddOverride={
            onAddFabric && l.structure_id
              ? (commit) => onAddFabric(l.structure_id as string, commit)
              : undefined
          }
          value={l.item_id}
          onChange={(id) => {
            onPatchLine(l.key, { item_id: id });
            clearFilter(l.key);
          }}
        />
      ),
    },
    {
      header: "Gsm",
      align: "right",
      width: "5rem",
      cell: (l) => <ClothText value={factsFor(l).gsm} />,
    },
    {
      /* `Type` IS OPEN/TUBULAR, AND IT IS ANSWERED HERE NOW (client 2026-09-02).
         It was an editable cell on the panel row and a read-only echo here;
         legacy draws it on this row and the client asked for legacy's placement.

         MANDATORY, AND THE STAR COMES FROM THE SAME DECLARATION THE SAVE GATE
         DOES — `fabricBomLineInput` refuses a line that names a fabric with no
         form, `required` draws the `*` and stamps `data-required-empty`, and the
         cursor holds. One declaration, four enforcers (AGENTS.md).

         IT IS NOW ASKED ONCE PER COLOURWAY, which is the cost the earlier
         placement avoided: four colourways of one panel are four mandatory cells
         holding for one answer that cannot differ by colour. The panel row's
         Fabric picker writes through to every colourway, so if this becomes the
         complaint, the same write-through is the fix — not moving the cell back. */
      header: "Type",
      required: true,
      width: "6rem",
      cell: (l) => (
        <Select
          compact
          className="h-8"
          required
          value={l.fabric_form}
          onChange={(e) => onPatchLine(l.key, { fabric_form: e.target.value })}
        >
          <option value="" />
          {FABRIC_FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      /* A COMBOBOX OVER THE ORDER'S OWN DYEING LIST, so the cell PICKS what
         earlier screens declared rather than accepting a fifth spelling of WHITE.
         `clearable` because a panel with no stated colour is an ordinary document.
         Typed text in a Combobox is a search and is never committed — see
         `commit` in combobox.tsx. */
      header: "Required Color",
      width: "9rem",
      cell: (l) => (
        <Combobox
          compact
          inputClassName="h-8"
          options={colourOptions.map((c) => ({ value: c, label: c }))}
          value={l.color_name}
          onChange={(v) => onPatchLine(l.key, { color_name: v })}
          clearable
        />
      ),
    },
    {
      header: "Required Print",
      width: "9rem",
      cell: (l) => (
        <Combobox
          compact
          inputClassName="h-8"
          options={printOptions.map((c) => ({ value: c, label: c }))}
          value={l.required_print}
          onChange={(v) => onPatchLine(l.key, { required_print: v })}
          clearable
        />
      ),
    },
    {
      header: "Specification",
      width: "10rem",
      cell: (l) => (
        <Input
          className="h-8"
          value={l.specification}
          onChange={(e) => onPatchLine(l.key, { specification: e.target.value })}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* LEVEL 1 — THE STYLE (client 2026-09-02, legacy screenshot 2613:
          `S No | StyleRefNo | StyleNo | ArticleNo`).

          READ-ONLY AND NOT A GRID. Legacy draws it as the outer band of a
          three-level tree and it is genuinely one row here — the tree is
          scoped to one style — so a grid around it would be chrome with a
          header, an ordinal and an "+ Add" for something nobody adds from
          this screen. Plain text also keeps it off the Tab path, the same
          call the Coordinate column makes: nothing is typed, so nothing
          should be a tab stop.

          IT PRINTS THE REF EVEN WHEN THE ORDER CANNOT NAME THE STYLE. A line
          carries `style_ref_no` by value, so the ref is always known; Style
          No and Article No come from the order's combo tree and dash when it
          has nothing to say. */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-1 rounded-md border border-border bg-surface-muted px-3 py-2">
        {[
          { label: "Style Ref No", value: styleIdentity?.ref || styleRefNo },
          { label: "Style No", value: styleIdentity?.style ?? "" },
          { label: "Article No", value: styleIdentity?.article ?? "" },
        ].map((f) => (
          <div key={f.label}>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
              {f.label}
            </dt>
            <dd className="m-0 text-sm font-medium">
              <Truncated>{f.value || "—"}</Truncated>
            </dd>
          </div>
        ))}
      </dl>

      {/* LEVEL 2 + LEVEL 3 — A MASTER-DETAIL PANE (client 2026-09-03,
          approved from the artifact: panels on the left, the open panel on the
          right).

          ## THIS IS `ChildGrid`'s `masterDetail`, NOT A LAYOUT BUILT HERE

          The rail, its 3px active border, its scroll cap, and its keyboard
          (↑↓ carry the selection, Enter drops the cursor into the form,
          roving tabindex so the pane costs ONE Tab stop) are all the
          primitive's — see `mdListKeyNav` in child-grid.tsx. The one screen
          that had this before is Material BOM, and the prop set is copied from
          it rather than rediscovered: `forceCards flatRows foldRows
          masterDetail` plus a `renderListItem`.

          ## WHAT THIS REPLACES, AND WHY THE TABLE COULD NOT DO IT

          A hand-written `<table>` stood here with each panel's colourways as a
          full-width row beneath it. Its own note explained the reason: "`ChildGrid`
          has no row-detail slot in table mode". That is true of TABLE mode only.
          In cards mode the row body is `renderMobileRow`, so the nested grid is
          simply part of it — which is why this version needs no
          `<thead>`/`<tbody>`, no `openPanel` state, and no hand-rolled
          `RequiredScope`: the fold, the ordinal, the ✕, `data-row-remove`,
          Ctrl+Del and the required-star contract all come back from the grid.

          ## THE RAIL APPEARS AT TWO PANELS, NOT ONE

          `mdActive` is `masterDetail && rows.length > 1`. A style with a single
          panel renders as one plain card with no rail, which is right: a list of
          one is not a list, and the same rule already governs Material BOM. */}
      <ChildGrid<PanelGroup>
        /* grid-caption: exempt -- the style band above names this grid, and it
           is the only grid at this level. */
        columns={panelColumns}
        rows={panels}
        /* CARDS, NOT A TABLE, and it is `masterDetail` that requires it: a
           `<tr>` cannot be a pane. `flatRows` keeps the section in ONE frame
           rather than a box per panel (the operator's standing rule). */
        forceCards
        flatRows
        /* ONE PANEL OPEN AT A TIME, which the row itself is the affordance for
           — focus or click opens it, exactly as the table did and as Order
           Entry's Structure Details does. There is no toggle control. */
        foldRows
        masterDetail
        /* INERT BY CONTRACT (see the prop): text and chips, nothing focusable.
           The fields live in the pane next door, and anything tabbable here
           would be a second stop per panel on a surface whose whole point is
           that it has one. */
        renderListItem={(p) => {
          const name = componentName(p.component_id);
          const coord = coordinateName(p.coordinate_id);
          return (
            <>
              <span className="block truncate text-sm font-semibold">
                {name || "New part"}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {coord && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {coord}
                  </span>
                )}
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {p.lines.length} {p.lines.length === 1 ? "colourway" : "colourways"}
                </span>
              </span>
            </>
          );
        }}
        /* REQUIRED BY `foldRows` AND ALL BUT UNUSED: with the rail active the
           folded rows ARE the rail and render nowhere else. It still has to
           exist — the grid gates its open-on-focus handler on
           `foldRows && renderFoldedRow` — and it IS what a single-panel style
           shows, where there is no rail. */
        renderFoldedRow={(p) => (
          <span className="text-sm font-medium">
            {componentName(p.component_id) || "New part"}
          </span>
        )}
        /* THE DETAIL PANE. `renderMobileRow` is the row body in cards mode, so
           this is both the open pane and the narrow-screen fallback — one
           definition, which is what stops the two drifting.

           `required={c.required}` IS NOT OPTIONAL HERE. A grid that renders its
           own row does not get `ChildGridColumn.required` routed into the
           control, so the star would draw with nothing behind it — the exact
           divergence AGENTS.md's "declare `required` twice" rule exists to
           prevent, and what `--check grid-required-mobile` looks for. */
        renderMobileRow={(p) => (
          <div className="space-y-3">
            <FieldGrid>
              {panelColumns.map((c, ci) => (
                <Field key={c.header} label={c.header} required={c.required} size="sm">
                  {c.cell(p, ci)}
                </Field>
              ))}
            </FieldGrid>
            <div>
              {/* THE CAPTION NAMES ITS PANEL, and that is not decoration: the
                  failure of the stacked version was two splits that could not
                  say whose they were. */}
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.09em] text-primary">
                Colourways{" "}
                <span className="font-normal tracking-[.04em] text-muted-foreground">
                  of {componentName(p.component_id) || "this panel"}
                </span>
              </div>
            <ChildGrid<MapLine>
              /* grid-caption: exempt -- the line above names this
                 grid AND the panel it belongs to, which a caption
                 cannot say. */
              columns={colourColumns}
              rows={p.lines}
              tableFrom="6xl"
              /* NO "+ Add" AND NO ✕. A panel is N lines, one per
                 colourway, and `onAddPanel` writes all N — an Add
                 here would invent a colourway the order does not
                 declare and a ✕ would delete one it does.
                 `hideRemove` rather than `lockExisting`, because
                 these rows are re-derived on every render and
                 `lockExisting` guards only the set present at
                 mount. */
              hideAdd
              hideRemove
              onAdd={() => false}
              onRemove={() => {}}
              renderMobileRow={(row, ri) => (
                <FieldGrid>
                  {colourColumns.map((c, ci) => (
                    /* `required={c.required}` IS NOT OPTIONAL HERE.
                       A grid that renders its own row calls this
                       INSTEAD of the `columns.map()` that wraps
                       each cell in `RequiredScope`, so
                       `ChildGridColumn.required` never reaches the
                       control — and the trap is that it still does
                       HALF its job: the header `*` draws, and
                       nothing holds. A star with nothing behind it
                       is the exact divergence the one-declaration
                       rule exists to make impossible, arriving
                       through the prop that is meant to guarantee
                       it (AGENTS.md, "Mandatory fields"). Four
                       screens rediscovered this independently;
                       `--check grid-required-mobile` is why this
                       one did not have to. */
                    <Field key={ci} label={c.header} required={c.required} size="sm">
                      {c.cell(row, ri)}
                    </Field>
                  ))}
                </FieldGrid>
              )}
            />
            </div>
          </div>
        )}
        /* RULE 2b, UNCHANGED FROM THE BUTTON THIS REPLACES — "when a
           structured fabric like Rib is selected, its component should
           automatically default to Neck".

           IT IS NOT A RULE ABOUT RIBS. `solePanel` fills the cell only when the
           style leaves exactly ONE panel available against this fabric, which on
           the client's own tee is NECK under 1X1 LYCRA RIB and nothing under
           Single Jersey (three panels, so nothing to default to). A style that
           ribs a cuff as well gets two options and no guess — and a guessed FK
           reads on screen exactly like a chosen one.

           COMPUTED AT THE MOMENT OF ADDING, over the panels already mapped, so
           the third Add on a Single Jersey with two panels taken DOES default to
           the one that is left — the client's rule 4, for free. */
        onAdd={() => {
          const seed = solePanel(
            availablePanels({
              decls,
              siblings: allLines,
              styleRefNo,
              structureId,
              held: null,
            }),
          );
          onAddPanel({
            component_id: seed?.component_id ?? null,
            coordinate_id: seed?.coordinate_id ?? null,
          });
        }}
        onRemove={(p) => onRemovePanel(p.key)}
        addLabel="+ Add part"
      />
    </div>
  );
}
