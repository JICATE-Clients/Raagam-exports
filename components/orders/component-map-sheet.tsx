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
 *   1. STYLE     — Style No, read-only. Style Ref No and Article No were
 *                  dropped from THIS band on 2026-09-04 (client cleanup
 *                  spec) — Manual's copy of `StyleIdentityBand` keeps all
 *                  three, via `omit`.
 *   2. PANEL     — Coordinate · Layout Type (0530, gates Component) ·
 *                  Component · Fabric Type (read-only). Folds.
 *   3. COLOURWAY — Assort Colour · Fabric Type · Fabric (GSM as a read-only
 *                  reference beneath it) · Type · Required Colour ·
 *                  Required Print.
 *
 * ## FIVE OF LEGACY'S COLUMNS ARE DELIBERATELY ABSENT, AND ONE FIELD IS NEW
 *
 * All five went the same day (2026-09-04, client cleanup spec: "purge
 * redundant columns" to fit the pane's width ceiling), in two passes.
 *
 * The first pass dropped **Structure** (the panel row's rolled-up
 * fabric-category name, e.g. "THREE-THREAD FLEECE") and **Specification**
 * (the colour row's free-text cell). Neither carried a write path this file
 * owned that the other columns did not already cover — Structure was a pure
 * `rollUp` of `factsFor(l).structure`, and Specification had no reader
 * anywhere in `lib/orders/fabric-bom` beyond its own Zod field
 * (`lib/orders/fabric-bom/types.ts`), which is untouched, so a value saved
 * before this change is not lost — it is simply no longer editable here.
 * The standalone `Gsm` column on both rows went the same pass, folded into a
 * read-only reference under each row's own `Fabric` cell instead.
 *
 * A second, same-day instruction dropped **Structure Type** (legacy prints
 * "Circular" on every row — this paragraph once argued at length for
 * restoring it, on 2026-09-02; the client has since asked for it gone again)
 * and the PANEL-LEVEL **Fabric** picker (which used to bulk-write every
 * colourway's cloth at once) outright. The per-colourway Fabric picker in
 * Level 3 is unchanged and is now the only place a panel's cloth is set from
 * this tab.
 *
 * **Layout Type is the one field this tab GAINED** (0530, section 4 of the
 * same spec): a new panel-row Select, gating the Component picker beside it
 * — see the panel column itself for the mechanism.
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
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGrid } from "@/components/ui/field";
import { RecordPicker } from "@/components/masters/record-picker";
import { Truncated } from "@/components/ui/truncated";
import { StyleIdentityBand } from "@/components/orders/style-identity-band";
import type { FieldSize } from "@/lib/ui/sizes";
import { cn } from "@/lib/utils";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  FABRIC_FORM_OPTIONS,
  LAYOUT_TYPE_OPTIONS,
  availablePanels,
  componentsHiddenForLayout,
  /* MOVED OUT OF THIS FILE (2026-09-03), unchanged. The Fabric Process tab's
     fabric row summarises N lines the same way — one structure type, one roll
     form, or "(mixed)" — and a second copy of a rule about abstaining is how two
     surfaces come to abstain differently. */
  rollUp,
  solePanel,
  type LayoutType,
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
  /** 'open_width' | 'tubular' (0530) — the PANEL's Layout Type, chosen before
   *  its Component. NOT `fabric_form` above — see the migration header. */
  layout_type: string | null;
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
 * A READ-ONLY CELL OF THE CLOTH — Structure, Fabric Type, Fabric, Gsm, Type,
 * Coordinate.
 *
 * NO `<Field>` WRAPPER SINCE BOTH LEVELS BECAME TABLES (client 2026-09-02). It
 * was `ClothCell`, which drew its own `Field` label — right inside a `FieldGrid`,
 * where every cell carries its own heading, and wrong in a table, where the
 * column header is the heading and a second one inside the cell would print the
 * name twice per row.
 *
 * A MUTED BOX, NOT A DISABLED `<Input>` — REVISED 2026-09-03 (client, on the
 * open-panel row specifically: "Coordinate, Structure, Structure Type, Gsm ...
 * looking orphaned, no layout, table border for this").
 *
 * THIS WAS BARE TEXT UNTIL THAT REPORT, ON A REAL ARGUMENT THAT STILL HOLDS
 * HALF OF ITSELF: "a greyed box says you may edit this once something else is
 * true ... a box the operator can click into and not change is the affordance
 * that makes them try." That is an argument against looking EDITABLE — it was
 * never an argument against having no border at all, and bare text in a row
 * otherwise full of bordered pickers is what read as "orphaned": four cells
 * with no visual weight, sitting beside three that have plenty.
 *
 * SO THE BOX IS BACK, TINTED RATHER THAN WHITE. `bg-surface-muted` is what
 * every EDITABLE control in this app is NOT — `Input`, `Select` and
 * `RecordPicker` all paint `bg-surface`, so a muted fill reads as "this one is
 * different" rather than as one more white box inviting a click. The original
 * worry is answered by the colour, not by the absence of a border.
 *
 * `<Truncated>` because a fabric name is legacy's longest cell by far
 * (`SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%`), and
 * an ellipsis with no way to read the rest is a dead end (AGENTS.md,
 * "Truncated values"). NO `tabIndex` — a read-only value is still not a field
 * (AGENTS.md, "Tab lands on fields"); the box says "this is a value", not
 * "this is a stop on the way through the row".
 */
/* EXPORTED FOR THE FABRIC PROCESS TAB (2026-09-03). Its fabric row is five
   read-only cells of exactly this shape — one control's height, muted, an em
   dash where there is no value, `Truncated` so a clipped composition bracket is
   still reachable. A second definition of "a read cell" is how two tabs of one
   screen come to render the same absence two different ways. */
export function ClothText({ value }: { value: string }) {
  return (
    /* `border-border-strong`, NOT `border-border` — REVISED AGAIN 2026-09-04
       (client, Manual's compact rail row: "no border in some of fields").
       `--border` (#cfd5dd) against this box's own `bg-surface-muted`
       (#f1f3f5) is a real but faint edge — legible at a table cell's normal
       width, and this box is now often squeezed to `xs` (~60px) beside a
       picker or Select whose OWN border carries a bright required-empty
       ring, which is exactly the comparison that made the fainter line
       disappear. `--border-strong` (#9aa4b2) is the same token
       `child-grid.tsx` already reaches for whenever a rule needs to be seen
       rather than merely present. */
    <div className="flex h-9 min-h-8 w-full items-center rounded-md border border-border-strong bg-surface-muted px-3 @2xl/editor:h-8">
      <Truncated className="text-sm text-muted-foreground">{value || "—"}</Truncated>
    </div>
  );
}

/** One panel of the fabric, with the lines (one per colourway) that carry it. */
type PanelGroup = {
  /** The panel's own key — its component id, or a placeholder for an unmapped row. */
  key: string;
  /**
   * THE PANEL'S IDENTITY FOR ANYTHING THAT OUTLIVES AN EDIT — which is the
   * accordion, and nothing else so far.
   *
   * `key` above is `component_id ?? panel_uid`, so it MUTATES the moment the row's
   * Component picker is filled in: the group's key jumps from the uid to the new
   * component id, and any state still holding the old one is pointing at a panel
   * that no longer answers to it. The split simply vanished, with nothing on
   * screen to say why.
   *
   * `panel_uid` cannot do that. It is minted once per panel and shared by every
   * colourway of it, in all three paths that create a line — the loader
   * (`component_id ?? p<id>`), `applySeed` (one uid per style/structure/panel) and
   * `addPanel` (one `newKey()` taken before the fan-out). Nothing patches it.
   *
   * `key` stays exactly as it was, because it is an ADDRESS rather than an
   * identity: `patchPanel` and `removePanel` resolve it through `inScope`
   * (fabric-bom-screen.tsx), which recomputes `component_id ?? panel_uid` per line.
   * The two are different jobs and must not be folded.
   */
  panel_uid: string;
  component_id: string | null;
  coordinate_id: string | null;
  fabric_form: string;
  /** THE PANEL'S OWN LAYOUT TYPE (0530) — 'open_width' | 'tubular', chosen
   *  before Component and gating that picker via `componentsHiddenForLayout`.
   *  Same rollup rule as `fabric_form`: every colourway of one panel is knit
   *  the same way, so there is nothing to roll up — the first line's value
   *  is the panel's. */
  layout_type: string | null;
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
   * ## `null` IS "EVERYTHING SHUT" — AND IT IS NOT WHAT THE OPERATOR SEES
   *
   * This block used to claim the mount state was everything shut, citing the
   * client's module-wide rule from 2026-08-19 ("instead of open one section the
   * sections should be in closed state, because it's making confusion for the
   * user"). The initial value really is `null`; the SCREEN never shows it.
   *
   * `MasterFullScreen` lands the cursor on the section's first field ~60ms after
   * the section opens (`land()` / the effect beside it in
   * components/masters/master-full-screen.tsx). That first field is row 1's
   * Component picker, the focus bubbles to its `<tr>`, and row 1 unfolds before
   * the operator has done anything. Every panel row is a field, so there is no
   * arrangement of this tree in which the landing lands on nothing.
   *
   * ACCEPTED RATHER THAN SUPPRESSED (2026-09-03). It is consistent with the rule
   * directly above — the open row is the row the cursor is in — and the landing
   * is app-wide behaviour that is correct for every other section, so bending it
   * here would mean teaching one screen to tell the section landing's focus apart
   * from an operator's. What is written down is the behaviour, because a comment
   * asserting the opposite of what the screen does is the kind of claim a reader
   * falsifies in a minute and then stops trusting the rest of the file.
   *
   * The 08-19 rule is not thereby waived: what it forbids is a fold whose open
   * row was CHOSEN for the operator while the cursor sits somewhere else. Revisit
   * if the client reports the auto-open itself.
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
   *
   * ## IT HOLDS A `panel_uid`, NOT A `PanelGroup.key`
   *
   * See the note on `PanelGroup.panel_uid`. `key` changes when the row's Component
   * is picked, and state keyed on a value the row itself edits is state that can
   * be orphaned by an ordinary edit.
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
          /* THE FIRST LINE'S UID IS THE PANEL'S — every colourway of one panel
             carries the same one by construction, so there is nothing to roll up
             here for the same reason `structure_id` below has nothing to roll up. */
          panel_uid: l.panel_uid,
          component_id: l.component_id,
          coordinate_id: l.coordinate_id,
          fabric_form: l.fabric_form,
          /* THE FIRST LINE'S LAYOUT TYPE IS THE PANEL'S, same reasoning as
             `fabric_form` above. */
          layout_type: l.layout_type,
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

  /**
   * THE OPEN PANEL IS `ChildGrid`'s NOW (2026-09-03), and the two hazards this
   * screen had to handle itself are worth recording, because whoever changes
   * `gridPanels` below inherits both.
   *
   * A KEY NAMING NO PANEL reads on screen as "everything is shut" — every row
   * closed, every click looking like it did nothing, and no way out by trying
   * harder. The grid reconciles `openRowKey` against the rows it is given, so
   * this no longer needs a derived `openKey` beside the raw state.
   *
   * A KEY THAT MOVES UNDER THE OPEN ROW is the other one, and it is the reason
   * `gridPanels` exists: `PanelGroup.key` is `component_id ?? panel_uid`, so it
   * changes the moment the Component picker is filled in. The grid is handed
   * `key: panel_uid` precisely so the fold survives that edit — see the note
   * there.
   *
   * NEITHER IS FIXED WITH AN EFFECT THAT CLEARS STATE. A panel can leave the
   * array for a render and come back — a patch in flight, a style re-grouped —
   * and an effect resetting the open key on the way through would shut a split
   * the operator is typing in. Reading past a momentarily unresolvable key
   * costs nothing; writing over it loses their place.
   */

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
  /**
   * A PANEL AS THE GRID SEES IT, and the two fields are master's own
   * distinction made literal rather than a second copy of it.
   *
   * `PanelGroup.key` is `component_id ?? panel_uid` and MUTATES the moment the
   * Component picker is filled in — its note calls it an ADDRESS, resolved
   * through `inScope` on the screen, and names `panel_uid` as the IDENTITY for
   * "anything that outlives an edit, which is the accordion".
   *
   * `ChildGrid` keys its rows, and tracks `openRowKey`, on `row.key`. Its fold
   * IS that accordion. So the grid is handed rows whose `key` is the uid, and
   * the address moves to `addr` for the cells that patch and remove. Keying the
   * grid on `key` instead would lose the open pane and the rail's selection the
   * instant an operator picked a Component — the exact defect master fixed
   * for the hand-rolled table this replaces.
   */
  type PanelRow = PanelGroup & { addr: string };

  const gridPanels: PanelRow[] = useMemo(
    () => panels.map((g) => ({ ...g, key: g.panel_uid, addr: g.key })),
    [panels],
  );

  /**
   * PER-FIELD WIDTH FOR THE OPEN-PANEL ROW, keyed by header rather than added
   * to `ChildGridColumn` — that type is shared across every grid in the app,
   * and a span belongs to how ONE screen lays its fields out, not to the
   * column's own definition. Looked up by header for the same reason
   * `FIELD_GROUPS` in Material BOM's own file is: this array is read in more
   * than one order-sensitive place, so an index would drift the day a column
   * moved.
   */
  /**
   * BY VALUE, NOT BY HABIT — three rounds on one row (client 2026-09-03):
   * "some field looks squeezed and some field have much gap ... based on
   * values can allocate space"; then "add extra little length to coordinate
   * and structure, fabric"; then, once Gsm's own border made its clip
   * visible, "gsm field ui will fix". Since 2026-09-04 `Structure` and the
   * standalone `Gsm` column are GONE (the client cleanup spec: GSM moved to
   * a read-only reference under Fabric, Structure dropped as a repeat of
   * what choosing the panel already states), a SECOND same-day instruction
   * dropped `Structure Type` and the panel-level `Fabric` picker outright,
   * and a NEW `Layout Type` field was ADDED before Component (section 4 of
   * the same spec, 0530) — so the row's span list is no longer only
   * shrinking. Nothing was re-tuned beyond giving the new field a size;
   * `Layout Type` reuses `Component`'s own `sm`, since both hold a short
   * fixed vocabulary next to a control with visible chrome (a Select, a
   * picker).
   *
   * EACH REMAINING SPAN IS STILL SIZED TO WHAT THE FIELD ACTUALLY HOLDS,
   * catalog-checked rather than guessed:
   *
   *   Coordinate      "PIECES" / "TOP"           — 3-6 chars
   *   Layout Type     "Open Width" / "Tubular"   — 6-10 chars, a Select
   *   Component       "SIDE PANELS", "NECK TAPE" — 8-11 chars, plus a picker
   *   Fabric Type     "Solid" / "Yarn Dyed"       — 5-9 chars, the shortest
   *                   field on the row, now read-only (see the column above)
   */
  const FIELD_SIZES: Record<string, FieldSize> = {
    Coordinate: "sm",
    "Layout Type": "sm",
    Component: "sm",
    "Fabric Type": "xs",
  };

  const panelColumns: ChildGridColumn<PanelRow>[] = [
    {
      /* COORDINATE IS SHOWN AND NOT EDITED. Legacy prints it and it is real
         information — PIECES vs TOP tells two identically-named panels apart —
         but it is a property OF the chosen component, so an editable box would be
         a second place for it to disagree with the order. Read-only TEXT rather
         than `<Input readOnly>`: nothing is typed, so nothing should be a tab
         stop. */
      header: "Coordinate",
      width: "7rem",
      /* `ClothText`, NOT A BARE `<Truncated>` (client 2026-09-03, screenshots
         2673-2674, "took reference ui from material bom" — comparing against
         Material BOM's own field band). Structure Type beside it also goes
         through `ClothText`, whose `min-h-8 items-center`
         wrapper centres the text against an h-8 control's height; this cell
         did not, so its line sat at its own natural baseline instead of level
         with the pickers and Selects either side of it — the one field in the
         row that read as sunk. Same value, same muted style; only the box it
         sits in changed. */
      cell: (p) => <ClothText value={coordinateName(p.coordinate_id) ?? ""} />,
    },
    {
      /* SECTION 4 OF THE "STRUCTURE DETAILS & COMPONENTS" SPEC (client,
         2026-09-04): "the component dropdown must filter dynamically based
         on [the panel's] layout type". Confirmed with the operator
         (AskUserQuestion, same date) as a NEW field here, before Component
         — not the colourway-row `fabric_form`/"Type" (sequenced AFTER
         Component, rejected as a gate on 2026-09-02 for repeating a
         mandatory cell down every colourway), and not the per-style
         DECLARED fact 0527 built for the Manual tab. See 0530's migration
         header for all three Open/Tubular-shaped columns this module now
         carries and why none of them merge.

         OPTIONAL, unlike Component beside it — see the Zod schema's own
         note (`fabricBomLineInput`) on why this is not a Save-blocking
         mandatory field. */
      header: "Layout Type",
      width: "7rem",
      cell: (p) => {
        /* THE SAME rule2+rule3 LIST COMPONENT READS, computed once here so
           the "would this leave nothing?" safety check can test each
           Layout Type against it without re-deriving `availablePanels`
           per option. */
        const declared = availablePanels({
          decls,
          siblings: allLines.filter((l) => !p.lines.some((x) => x.key === l.key)),
          styleRefNo,
          structureId: p.structure_id ?? structureId,
          held: p.component_id,
        });
        /* GREY OUT A LAYOUT TYPE THAT WOULD LEAVE THE COMPONENT DROPDOWN
           EMPTY (spec's "Safety Check"). The panel's OWN held component
           always keeps its Layout Type selectable — disabling the value a
           panel already carries would make an answered row look wrong. */
        const emptyUnder = (lt: LayoutType) => {
          if (p.layout_type === lt && p.component_id) return false;
          const hidden = componentsHiddenForLayout(decls, styleRefNo, lt);
          return declared.every((o) => hidden.has(o.component_id));
        };
        return (
          <Select
            compact
            className="h-8"
            value={p.layout_type ?? ""}
            onChange={(e) =>
              onPatchPanel(p.addr, { layout_type: e.target.value || null })
            }
          >
            <option value="" />
            {LAYOUT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={emptyUnder(o.value)}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      },
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
        /* RULE 4 (0530) — HIDE WHAT THIS PANEL'S CHOSEN LAYOUT TYPE PROVABLY
           EXCLUDES. `componentsHiddenForLayout` already owns "nothing chosen
           hides nothing" and "hide only when EVERY declaration disagrees" —
           this cell only has to keep the HELD component visible regardless,
           the same held-survival guarantee `availablePanels` above gives rule
           2+3, now extended to rule 4 as its own docstring requires
           ("THE CALLER STILL OWNS HELD SURVIVAL"). */
        const hiddenByLayout = componentsHiddenForLayout(
          decls,
          styleRefNo,
          (p.layout_type as LayoutType) || null,
        );
        const visible = options.filter(
          (o) => o.component_id === p.component_id || !hiddenByLayout.has(o.component_id),
        );
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
        const items: PickerRow[] = visible.map(
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
              onPatchPanel(p.addr, {
                component_id: id,
                /* THE COORDINATE COMES WITH THE PANEL and is never picked
                   separately. The order's declaration pairs them, so asking twice
                   is asking the operator to restate something they have already
                   said — and to get it wrong. */
                coordinate_id:
                  visible.find((o) => o.component_id === id)?.coordinate_id ?? null,
              })
            }
          />
        );
      },
    },
    /* THE CLOTH SUMMARY IS GONE FROM THIS ROW ENTIRELY (client cleanup spec,
       2026-09-04) — legacy's `Structure Type | Fabric Type | Fabric` went in
       three passes on the same day, this being the third and last:

         1. Structure Type and the panel-level Fabric picker (which
            bulk-wrote every colourway at once) — removed together, "purge
            redundant columns".
         2. A standalone `Structure` cell was never added back for the same
            reason: it printed the same fabric-category name the panel's own
            Component picker was already filtered and scoped by
            (`structureId`), repeating a fact the operator supplied by
            choosing the panel rather than stating a new one.
         3. `Fabric Type` itself, THIS instruction ("before Fabric Type …
            near the Component … remove this one only") — by the time it
            reached this point it had already been made read-only (the
            panel-level Fabric picker it used to narrow was gone), so it was
            a pure echo of `fabricTypeOfId` with nothing left to do. Removed
            outright rather than left as dead chrome.

       NAMED "this one only" DELIBERATELY: the colourway row's own `Fabric
       Type` cell below is UNCHANGED — it still narrows that row's own
       per-colourway Fabric picker and stays live. Two cells shared a label
       and only one of them had a job left; only that one left the row.
       The per-colourway Fabric picker is now the only place a panel's cloth
       is set or summarised on this tab. */
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
   * LEVEL 3's COLUMNS — legacy's order (screenshot 2613), minus `Conv. Item`,
   * minus `Gsm` (2026-09-04 — GSM is "already declared and locked" on the
   * fabric master; kept only as a read-only reference under the Fabric cell,
   * not a column of its own), and minus `Specification` (same date, same
   * cleanup spec — "purge redundant columns"; the field itself is untouched,
   * see the note where the column used to sit).
   *
   *   S No · Assort Color · Fabric Type · Fabric · Type ·
   *   Required Color · Required Print
   *
   * FABRIC TYPE / FABRIC ARE REPEATED FROM THE PANEL ROW AND ARE NOT
   * REDUNDANT. `item_id` is a column of the LINE, and a line is per colourway, so
   * a white body and a navy body may name two different fabric items — the panel
   * row rolls them up and says "(mixed)", and these are where the values are.
   *
   * Widths: 6 + 5 + 10 + 6 + 6 + 6 = 39rem = 624px, well inside this
   * nested grid's own (rail-reduced) pane.
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
      width: "6rem",
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
      width: "5rem",
      cell: (l) => typeCell(l.key, l.item_id),
    },
    {
      /* THE PER-COLOURWAY OVERRIDE. `item_id` is a column of the LINE, so a white
         body and a navy body may legitimately name two cloths; the panel row
         above writes every colourway at once and this changes one. */
      header: "Fabric",
      /* 10rem, up from 8rem now the standalone `Gsm` column is gone (client
         cleanup spec, 2026-09-04 — same instruction as the panel row above
         and Fabric Allocation's own Fabric cell). */
      width: "10rem",
      cell: (l) => (
        <div className="flex min-w-0 flex-col gap-0.5">
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
        {/* THE READ-ONLY GSM REFERENCE — see the panel row's own note above;
            this is the per-colourway line's own value, not a roll-up. */}
        {factsFor(l).gsm && (
          <Truncated className="block text-[10px] leading-tight text-muted-foreground">
            {factsFor(l).gsm} GSM
          </Truncated>
        )}
        </div>
      ),
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
      width: "6rem",
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
      width: "6rem",
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
    /* NO `Specification` CELL (client cleanup spec, 2026-09-04 — "purge
       redundant columns"). `specification` stays on `MapLine` and on the
       line's own Zod schema (`lib/orders/fabric-bom/types.ts`), untouched —
       only the editable cell is gone, so a value saved before this change is
       not lost, just no longer reachable from this screen. */
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
      {/* WHITE, NOT FILLED — see the note on the header row below, which is
          the same rule and the same client instruction. The border already
          says this is a band. */}
      {/* ONE COMPONENT, TWO TABS — `StyleIdentityBand`, RE-APPLIED ACROSS THIS
          MERGE (2026-09-03). This branch was cut before the band was extracted,
          so its own copy of the markup came back with the master-detail
          redesign. The Manual tab draws the shared component, and the client's
          instruction was that Manual look "like same components tab" — two
          copies is how that stops being true without anyone editing either.

          `omit={["ref", "article"]}` HERE ONLY (client cleanup spec,
          2026-09-04: delete Style Ref No and Article No from this tab).
          Manual's own call site is untouched, so it keeps all three — the
          spec names "the Structure Details and Component sub-panels", not
          Manual's identity band. */}
      <StyleIdentityBand
        styleRefNo={styleRefNo}
        identity={styleIdentity}
        omit={["ref", "article"]}
      />

      {/* LEVEL 2 + LEVEL 3 — A MASTER-DETAIL PANE (client 2026-09-03,
          approved from the artifact: panels on the left, the open one on the
          right).

          ## IT IS `ChildGrid`'s `masterDetail`, TAKEN FROM MATERIAL BOM

          The rail, its 3px active border, its scroll cap and its keyboard
          (↑↓ carry the selection, Enter drops the cursor into the form,
          roving tabindex so the whole pane costs ONE Tab stop) are the
          primitive's — see `mdListKeyNav` in child-grid.tsx. Material BOM is
          the screen that had this first, and its prop set is copied rather than
          rediscovered: `forceCards flatRows foldRows masterDetail` plus a
          `renderListItem`.

          ## WHY THE HAND-WRITTEN TABLE COULD GO

          Its own note explained itself: "`ChildGrid` has no row-detail slot in
          table mode". True of TABLE mode only. In cards mode the row body is
          `renderMobileRow`, so a nested grid is simply part of it — which is
          why this needs no `<thead>`/`<tbody>`, no `openPanel` state and no
          hand-rolled `RequiredScope`, and gets the fold, the ordinal, the ✕,
          `data-row-remove`, Ctrl+Del and the required-star contract back.

          ## THE `panel_uid` FIX IS KEPT, JUST MOVED

          The table tracked its open panel in `openPanel`/`openKey` because
          `PanelGroup.key` mutates when the Component is picked. That state is
          gone, and the same protection now lives in `gridPanels`, which hands
          the grid `key: panel_uid`. See the note there.

          ## THE RAIL APPEARS AT TWO PANELS, NOT ONE

          `mdActive` is `masterDetail && rows.length > 1`, so a style with a
          single panel renders as one plain card with no rail. A list of one is
          not a list, and Material BOM behaves the same way. */}
      {/* THE RAIL NOW MATCHES MATERIAL BOM'S OWN, FULL STOP (client
          2026-09-03, screenshots 2676-2678, repeated: "same like material bom
          tab layout, size, color everything ... just customizing for this
          screen"). `data-md-plain` stood here for one afternoon opting OUT of
          the skin's blue ring ("remove blue bg colour for carts"); that
          instruction is reversed by this one, which asks for the opposite —
          the same ring, the same fill, the same everything Material BOM's
          rail already has. Nothing to write here any more: the grid gets the
          skin's default treatment by not opting out of it. */}
      <ChildGrid<PanelRow>
        /* grid-caption: exempt -- the style band above names this grid, and it
           is the only grid at this level. */
        columns={panelColumns}
        rows={gridPanels}
        /* CARDS, NOT A TABLE, and `masterDetail` requires it: a `<tr>` cannot
           be a pane. `flatRows` keeps the section in ONE frame rather than a
           box per panel, which is the operator's standing rule. */
        forceCards
        flatRows
        /* 220px — NEITHER OF THE PRIMITIVE'S TWO NAMED WIDTHS (client
           2026-09-03, the third number on this one rail in one day). 160
           ("the rail is sized to its text") was too tight for the subtitle
           and figure this rail grew once "same as Material BOM" arrived;
           268 (Material BOM's own width, and this rail's setting for a few
           commits) read as wider than the client's own reference screenshot
           once the two sat side by side. `railWidthPx` exists on the
           primitive because of this exact call site — see its own note on
           `child-grid.tsx` — so this is a number, not a second boolean. */
        railWidthPx={220}
        /* TIGHTER PADDING TOO (client, same afternoon: "use compact that
           rail menu"). Independent of the width now — see `railCompact`'s
           own note on `child-grid.tsx` for why the two stopped being one
           flag. */
        railCompact
        /* THE TINT IS OFF (client 2026-09-04: "need remove that grey bg from
           that rail"). This reverses the 2026-09-03 "match Material BOM,
           full stop" instruction for the pane's background only — width,
           padding and the ring above stay matched; see `railBg`'s own note
           on `child-grid.tsx`. */
        railBg={false}
        /**
         * `fill` IS LOAD-BEARING HERE, AND ITS ABSENCE IS WHAT BROKE THE PANE
         * (reported 2026-09-03 with a screenshot: every field stacked in a
         * ~185px column, the row's ✕ sitting beside "Coordinate").
         *
         * `hugsContent` is `!fill && columns.every((c) => c.width)`. All seven
         * `panelColumns` declare a width — they were written for a table — so
         * the hug switched itself on and the grid card took `w-fit`. Inside a
         * shrink-wrapped parent the master-detail track
         * (`md:grid-cols-[268px_minmax(0,1fr)]`) resolves its `1fr` against
         * min-content, so the detail pane collapsed to about the width of one
         * field. Everything else followed from that: under `@lg/section`
         * (512px) `FIELD_TRACK` declares no `grid-cols` at all, so every
         * `Field` stacked one per row, and the card's `absolute right-1 top-1`
         * remove button landed next to the first label.
         *
         * MATERIAL BOM NEVER HIT THIS, which is why copying its prop set was
         * not enough: its eleven columns declare NO widths, so `hugsContent` is
         * false there by accident of the data rather than by decision.
         *
         * THE COUPLING IS THE THING TO REMEMBER: a column `width` is a TABLE
         * concern, and declaring one silently changes how the CARD lays out.
         * `fill` suppresses only the hug — the columns keep their widths, and
         * the slack falls to the right of them.
         */
        fill
        /* ONE PANEL OPEN AT A TIME, the row itself being the affordance —
           focus or click opens it, exactly as the table did and as Order
           Entry's Structure Details does. There is no toggle control. */
        foldRows
        masterDetail
        /* OPENS ON THE FIRST PART RATHER THAN NOTHING (2026-09-04, operator:
           "why the bottom looks so flying … default open first component
           with that table panel"). Opt-in on `child-grid.tsx`'s own prop —
           see its note for why this is not the same question as "a grid
           opens with everything folded" (Structure Details, 2026-08-19):
           that rule is about a document's sections re-expanding as noise;
           this is a navigation rail with nothing to navigate TO, which reads
           as broken rather than calm. */
        defaultOpenKey={gridPanels[0]?.key ?? null}
        /* INERT BY CONTRACT (see the prop): text and chips, nothing focusable.
           The fields live in the pane next door, and anything tabbable here
           would be a second Tab stop per panel on a surface whose whole point
           is that it has one. */
        /* THE NAME AND NOTHING ELSE (client 2026-09-03, screenshot 154846:
           "this text only and remove pieces and 1 colourway").

           IT CARRIED A COORDINATE CHIP AND A COLOURWAY COUNT, and both were
           saying something the pane already says: Coordinate is the first field
           on the right, and the count is the caption over the Colourways grid
           under it. In a rail the operator reads to FIND a part, a second line
           per entry doubles the height and halves how many parts are on screen
           — eight of them is a scroll where it need not be one.

           ONE LINE IS ALSO WHAT MAKES THE ENTRY COMPACT. The padding is
           `ChildGrid`'s own (`px-3 py-2`); dropping the meta row is what takes
           each card from two lines to one, so nothing here sets a height. */
        /**
         * MATERIAL BOM'S SHAPE, MINUS THE FIGURE (client 2026-09-03, three
         * rounds on this one row: "same ... size, color everything" brought
         * the dot, name and subtitle back after "this text only" had cut them;
         * "remove that colourway1 wording, use compact" now drops the fourth
         * piece — the count Material BOM prints on its own rail.
         *
         * A material's rail figure is the one number Material BOM has nowhere
         * else to put — it is the LINE's own total, read nowhere else on that
         * screen. A panel's colourway count is not that: it is printed once
         * already, in the caption over the Colourways grid the moment the
         * panel is open, so on THIS rail the count was the one part of
         * Material BOM's shape that was saying something twice rather than
         * once. Dropping it is what "customized for this screen" turns out to
         * mean here — three of Material BOM's four things, not a fourth
         * invented to fill the slot.
         *
         * SHORTER FOR FREE, ALSO THE COMPACTNESS ASKED FOR: the row was two
         * lines fighting a right-aligned column for the same width; without
         * the count the subtitle line runs the full row and the entry reads
         * lighter without a padding number to tune.
         */
        renderListItem={(p) => {
          const name = componentName(p.component_id);
          const structure = rollUp(p.lines.map((l) => factsFor(l).structure));
          const n = p.lines.length;
          const answered = p.lines.filter((l) => l.fabric_form.trim()).length;
          /* THREE STATES, THE SAME READING `manualEntryColumns`' rail uses one
             tab along: idle before a component is named (nothing to answer
             yet), warn once it is named and something on it is not, ok once
             every colourway states its Type. */
          const state = !name ? "idle" : n > 0 && answered === n ? "ok" : "warn";
          return (
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  state === "ok" && "bg-success",
                  state === "warn" && "bg-warning",
                  state === "idle" && "bg-border-strong opacity-50",
                )}
              />
              <span className="min-w-0 flex-1">
                <Truncated className="block text-[12.5px] font-medium leading-tight text-foreground">
                  {name || "New part"}
                </Truncated>
                {structure && (
                  <Truncated className="block text-[10px] leading-tight text-muted-foreground">
                    {structure}
                  </Truncated>
                )}
              </span>

            </div>
          );
        }}
        /* SAME CONTENT, THE FOLDED SHAPE — what a single-panel style shows (no
           rail to carry a dot or a count) and what `foldRows` requires to
           exist at all. */
        renderFoldedRow={(p) => (
          <span className="text-sm font-medium">
            {componentName(p.component_id) || "New part"}
          </span>
        )}
        /* THE DETAIL PANE. `renderMobileRow` is the row body in cards mode, so
           this is the open pane AND the narrow-screen fallback — one
           definition, which is what stops the two drifting.

           `required={c.required}` IS NOT OPTIONAL HERE. A grid that renders its
           own row does not get `ChildGridColumn.required` routed into the
           control, so the star would draw with nothing behind it — the exact
           divergence AGENTS.md's "declare `required` twice" rule exists to
           prevent, and what `--check grid-required-mobile` looks for. */
        renderMobileRow={(p) => (
          <div className="space-y-3">
            {/* NO NAME HERE ANY MORE (client 2026-09-03: "the first tile of
                the section front body already the side rail showing so no
                need show again in that page screen ... remove it").

                THIS UNDOES THE HEADING ADDED EARLIER THE SAME DAY, and the
                reason is not a change of mind about whether the open panel
                needs naming — it is that a SECOND fix made the first one
                redundant. The heading was built when the rail said only a
                bare part name; once the rail became Material BOM's own shape
                (a dot, the name, the structure, the colourway count), the
                name and the count were both being said twice, one column
                apart, and the client is right that the second saying earns
                nothing the first did not.

                THE ✕ STILL NEEDS THE `pr-9` ROOM `cornerRemove` FLOATS INTO
                — that half of the old heading's job stays, on a bare spacer
                rather than on text that repeats the rail. Dropping the whole
                block would bring back the ORIGINAL defect this heading was
                built to fix: an ✕ with nothing above it to belong to. */}
            <div className="h-1 pr-9" />
            {/* SIZED LIKE MATERIAL BOM'S OWN FIELDS, NOT A UNIFORM `xs` ROW
                (client 2026-09-03, screenshots 2676-2678: "same ... size ...
                everything"; refined the same day against the RESULT — "some
                field looks squeezed and some field have much gap ... based
                on values can allocate space"). `cols={14}` at a flat `xs` was
                the original answer to "all seven on one row" — 155px for
                every field regardless of what it held, which squeezed
                Structure's 20-character names exactly as much as Gsm's
                9-character range.

                `cols={32}`, the SAME track the colourways row below already
                uses. Spans are now BY VALUE (`FIELD_SIZES`, above) rather than
                by a flat guess — see that constant for the per-field
                reasoning and the catalog figures behind each one. */}
            <FieldGrid cols={32}>
              {panelColumns.map((c, ci) => (
                <Field
                  key={c.header}
                  label={c.header}
                  required={c.required}
                  size={FIELD_SIZES[c.header] ?? "xs"}
                >
                  {c.cell(p, ci)}
                </Field>
              ))}
            </FieldGrid>
            <div>
              {/* NO "COLOURWAYS OF <PANEL>" CAPTION (client 2026-09-03).

                  IT EARNED ITS PLACE UNDER THE OLD LAYOUT AND DOES NOT UNDER
                  THIS ONE, which is the whole reason it can go. The stacked
                  table drew every panel's split one under another, so a caption
                  was the only thing saying WHOSE colourways these were — drop it
                  there and two splits become indistinguishable. A master-detail
                  pane shows exactly ONE panel at a time and names it twice
                  before this line is reached: the selected entry in the rail,
                  and the Component field at the top of the pane. A third naming
                  is what the client is looking at when they call it noise. */}
            <ChildGrid<MapLine>
              /* grid-caption: exempt -- the pane holds ONE panel at a
                 time and names it twice before this grid is reached
                 (the selected rail entry, and the Component field
                 above), so a caption would be a third naming. This
                 reason REPLACES "the line above names it": that line
                 was removed on 2026-09-03 -- see the note there. */
              columns={colourColumns}
              rows={p.lines}
              /* NO `tableFrom` OVERRIDE — the default `@lg` (512px) switch,
                 and this is the second correction to this ONE line in one day.

                 `5xl` (1024) replaced `6xl` (1152) on the earlier merge, reasoned
                 against the FULL 1155px pane `check:grid-budget` measures — and
                 that reasoning does not apply here, because this grid is nested
                 INSIDE the master-detail split, not laid out across the whole
                 pane. With the rail at Material BOM's own 268px (re-applied the
                 same day this line last changed), the detail side gets at most
                 ~867px on that same 1366x768 laptop — under `5xl` outright, so
                 the "fix" was still wrong, just not wrong enough to show on a
                 wider screen.

                 `check:grid-budget`'S OWN HEADER SAYS SO: "a grid nested inside a
                 master-detail pane has far less width than MIN_PANE ... passing
                 here is necessary and not sufficient for one of those." This is
                 that grid. Leaving `tableFrom` unset is what makes the primitive
                 responsible for the number instead of a second guess at it here:
                 `@lg` is well inside 867px for `colourColumns`' own ~66rem, so
                 the table shows on the narrowest screen this app supports
                 without this file re-deriving what fits. */
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
                /* SIX ON ONE ROW (originally eight, client 2026-09-03; `Gsm`
                   and `Specification` both dropped 2026-09-04): Assort
                   Color, Fabric Type, Fabric, Type, Required Color, Required
                   Print.

                   STILL `cols={32}`, NOT RE-TUNED DOWN. 12 or 14 would fit six
                   `md` (4) fields with less left over, but `colourColumns`
                   above is shared with the DESKTOP table's own widths and
                   `FIELD_SIZES` two fields up the file, both keyed to the
                   32-track's numbers ("275 - 285" reasoning etc.) — a second
                   track here would need those re-derived for no visible gain,
                   since 6 × `md` (4) = 24 of 32 simply leaves the row's own
                   trailing quarter blank rather than misaligning anything.

                   THIS IS THE CARD PATH, NOT THE TABLE, and that is why the
                   fix belongs here. The grid still declares `tableFrom="6xl"`,
                   and its own column widths total ~1128px including the ordinal
                   — more than this detail pane gets — so the table would only
                   appear by scrolling sideways, which the operator's rule 4
                   bans. Below that breakpoint `renderMobileRow` IS the row, and
                   this is it.

                   At 4/32 a field is ~137px, comfortable for the three
                   Selects, the derived Fabric name and the colour combos.
                   Nothing is lost — the controls clip with an ellipsis and
                   `<Truncated>` reveals the rest. */
                <FieldGrid cols={32}>
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
                    <Field key={ci} label={c.header} required={c.required} size="md">
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
           style leaves exactly ONE panel available against this fabric, which
           on the client's own tee is NECK under 1X1 LYCRA RIB and nothing under
           Single Jersey (three panels, so nothing to default to). A style that
           ribs a cuff as well gets two options and no guess — and a guessed
           FK reads on screen exactly like a chosen one.

           COMPUTED AT THE MOMENT OF ADDING, over the panels already mapped, so
           the third Add on a Single Jersey with two panels taken DOES default
           to the one left — the client's rule 4, for free. */
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
        /* THE ADDRESS, NOT THE GRID'S KEY — `removePanel` resolves
           `component_id ?? panel_uid` through `inScope`. See `gridPanels`. */
        onRemove={(p) => onRemovePanel(p.addr)}
        /* THE BUTTON MATCHES THE PILLS. `ChildGrid`'s add is
           `variant="outline" size="sm"`, already `text-xs`; this trims its `px-3`
           to the entries' `px-2.5` so the rail keeps one left edge from the first
           part down to the button. */
        addClassName="px-2.5"
        addLabel="+ Add part"
      />
    </div>
  );
}
