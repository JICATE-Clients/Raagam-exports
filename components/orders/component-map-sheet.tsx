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

import { Fragment, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGrid } from "@/components/ui/field";
import { RecordPicker } from "@/components/masters/record-picker";
import { Truncated } from "@/components/ui/truncated";
import { Button } from "@/components/ui/button";
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
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

export type PickerRow = { id: string; code: string | null; name: string; inactive?: boolean };

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
  const [openPanel, setOpenPanel] = useState<string | null>(null);

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
      header: "Fabric Type",
      width: "6rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).fabricType))} />,
    },
    {
      header: "Fabric",
      width: "16rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).fabric))} />,
    },
    {
      header: "Gsm",
      align: "right",
      width: "5rem",
      cell: (p) => <ClothText value={rollUp(p.lines.map((l) => factsFor(l).gsm))} />,
    },
    {
      /* OPEN/TUBULAR STAYS ON THE PANEL ROW, and legacy draws it on the colour
         row. Confirmed with the client on 2026-09-02 while matching everything
         else to legacy: it is mandatory, and a cell repeated identically down
         four colourways invites three of them to be left blank while it holds the
         cursor — four holds for one answer that cannot differ by colour. The
         colour row ECHOES it read-only, so the layout still reads like legacy's.

         MANDATORY, AND THE STAR COMES FROM THE SAME DECLARATION THE SAVE GATE
         DOES — `fabricBomLineInput` refuses a line with a fabric and no form,
         `required` draws the `*` and stamps `data-required-empty`, and the cursor
         holds. One declaration, four enforcers (AGENTS.md). */
      header: "Open / Tubular",
      required: true,
      width: "7rem",
      cell: (p) => (
        <Select
          compact
          className="h-8"
          required
          value={p.fabric_form}
          onChange={(e) => onPatchPanel(p.key, { fabric_form: e.target.value })}
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
      width: "6rem",
      cell: (l) => <ClothText value={factsFor(l).fabricType} />,
    },
    { header: "Fabric", width: "12rem", cell: (l) => <ClothText value={factsFor(l).fabric} /> },
    {
      header: "Gsm",
      align: "right",
      width: "5rem",
      cell: (l) => <ClothText value={factsFor(l).gsm} />,
    },
    {
      /* `Type` IS THE PANEL'S Open/Tubular, ECHOED. Legacy draws it on this row;
         it is answered once above and shown here so the row still reads like
         legacy's. Read from the LINE rather than from the open panel, so it stays
         right regardless of which panel is expanded. */
      header: "Type",
      width: "6rem",
      cell: (l) => (
        <ClothText
          value={FABRIC_FORM_OPTIONS.find((o) => o.value === l.fabric_form)?.label ?? ""}
        />
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

          {/* LEVEL 2 + LEVEL 3 — THE PANELS, EACH WITH ITS OWN SPLIT DIRECTLY
              BENEATH IT (client 2026-09-02, artifact approved: "need to split it
              below of that actual coordinate, not like this manner").

              ## WHY THIS IS A HAND-WRITTEN `<table>` AND NOT A `ChildGrid`

              `ChildGrid` has no row-detail slot in table mode — its own note says
              a nested grid is "markup the caller emits" — and that limit is
              exactly what produced the layout the client rejected: with nowhere
              to put a detail row, every panel's split stacked underneath the
              whole table. Both splits then read "PANEL — COLOURWAYS", because a
              split names its panel by Component and neither had been picked, so
              nothing on screen tied either one to a row.

              A full-width row BETWEEN records is the only shape that cannot come
              adrift, and it is one only the caller can write. So the outer grid
              is ours; the colourway grids inside it stay `ChildGrid`s.

              ## THE CONTRACT MARKERS ARE CARRIED DELIBERATELY

              AGENTS.md is explicit that a hand-rolled grid is how ~22 screens
              drifted off the keyboard contract, and that the fix is never
              per-screen. This grid is hand-rolled for a layout reason, so it pays
              the contract in full rather than opting out of it:

                · `data-grid-body` + `gridKeyNav` on the SAME element — the
                  handler reads `e.currentTarget`, so they cannot be split;
                · `data-grid-row` per record, which is the axis ↑↓←→ walk and what
                  scopes `ownDescendants`;
                · `data-row-remove` on each ✕, so Ctrl+Del still deletes a panel
                  now that Tab lands on fields only;
                · `data-row-add` on "+ Add part", which is what Enter steers by.

              Nothing here sets `tabIndex` — `cycleTab` already skips non-fields
              on every surface, and a local override is the per-component patch
              the rule bans (it would also drop the ✕ out of screen-reader order).

              ## WHAT IS LOST, STATED RATHER THAN DISCOVERED

              The `#` ordinal, the header band and the row chrome came free from
              `ChildGrid` and are now written here. That is the one place this can
              drift from the Fabric Lines grid beside it — so the columns stay
              declared in `panelColumns`, and the header row and the body read the
              SAME array. A column added there appears in both or in neither.

              THE STACKED-CARD FALLBACK IS ALSO GONE, and this is the real cost.
              `ChildGrid` swaps to cards below `tableFrom`; this table scrolls
              sideways instead. On a phone that is worse, and this app ships as an
              installed PWA — but a full-width detail row is a TABLE construct, so
              a card layout would have to re-invent the nesting the client asked
              for rather than degrade to it. The colourway grids inside keep their
              own card fallback. If the panel level needs one, it is a second
              renderer here, not a change to the shape. */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-9 whitespace-nowrap border-b border-border bg-surface-muted px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[.07em] text-muted-foreground">
                    #
                  </th>
                  {panelColumns.map((c) => (
                    <th
                      key={c.header}
                      style={c.width ? { width: c.width } : undefined}
                      className={`whitespace-nowrap border-b border-border bg-surface-muted px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[.07em] text-muted-foreground ${
                        c.align === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      {c.header}
                      {/* required-star: exempt -- DERIVED FROM `ChildGridColumn.required`,
                          not typed. This is the star `ChildGrid` draws from the same
                          prop; it is written out here only because the outer grid is
                          hand-rolled for the split row below, and the check reads a
                          literal `*` in source without seeing what produced it.

                          BOTH HALVES ARE PRESENT, which is what the rule actually
                          asks for and what AGENTS.md calls declaring `required`
                          TWICE on a grid that renders its own row: `required: true`
                          on the column draws this star, and the CONTROL inside the
                          cell carries `required` too (RecordPicker on Component,
                          Select on Open/Tubular) — so the field stamps
                          `data-required-empty` and the cursor holds. A star with
                          nothing behind it is the exact divergence being guarded
                          against, and it is not what this is. */}
                      {c.required && <span className="text-danger">*</span> /* required-star: exempt -- derived from `ChildGridColumn.required`, and the cell's control carries `required` too, so the cursor genuinely holds. Full reasoning directly above; the marker sits on THIS line because a JSX comment block closes with a brace that `exempt_above` reads as code, so its walk upward stops before reaching it. */}
                    </th>
                  ))}
                  <th className="w-9 border-b border-border bg-surface-muted" />
                </tr>
              </thead>
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
                {panels.map((p, i) => (
                  <Fragment key={p.key}>
                    <tr
                      data-grid-row
                      /* FOCUS OPENS IT — the keyboard's whole route in, and the
                         auto-close in one handler: arriving anywhere in a row
                         makes that row the open one, so moving to the next panel
                         shuts the previous. `onFocus` bubbles, so this catches
                         the mouse and the keyboard alike. */
                      onFocus={() => setOpenPanel((k) => (k === p.key ? k : p.key))}
                      /* AND A CLICK ANYWHERE, MINUS BUTTONS. The row's ✕ is
                         inside this handler's reach, and unfolding a panel on the
                         way to deleting it is a flicker with no purpose. */
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        setOpenPanel(p.key);
                      }}
                      className={
                        openPanel === p.key ? "bg-surface-muted/60" : "cursor-pointer"
                      }
                    >
                      <td className="border-b border-border/50 px-2 py-1.5 text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                      </td>
                      {panelColumns.map((c, ci) => (
                        <td
                          key={c.header}
                          className={`border-b border-border/50 px-2 py-1.5 align-middle ${
                            c.align === "right" ? "text-right" : ""
                          }`}
                        >
                          {c.cell(p, ci)}
                        </td>
                      ))}
                      <td className="border-b border-border/50 px-1 py-1.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-row-remove
                          aria-label={`Remove ${componentName(p.component_id) ?? "panel"}`}
                          className="text-danger hover:text-danger"
                          onClick={() => onRemovePanel(p.key)}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>

                    {/* THE SPLIT — a full-width row of THIS table, so it can
                        never come adrift from the record above it. Indented past
                        the ordinal and rail-marked, which is what says
                        "subordinate" without a second frame; the caption names
                        the panel, because the whole failure of the stacked
                        version was two splits that could not say whose they
                        were.

                        RENDERED ONLY WHILE OPEN, never hidden with CSS. A
                        display-hidden row keeps its fields in the DOM, and
                        `focusablesIn` tests `offsetParent` — so Tab would skip
                        them correctly, but `landOnAddedRow` diffs the grid body
                        to find what APPEARED, and fields that were always there
                        are not new. Unmounting is what makes the open land
                        somewhere. */}
                    {openPanel === p.key && (
                    <tr>
                      <td colSpan={panelColumns.length + 2} className="bg-surface-muted p-0 pl-9">
                        <div className="border-l-[3px] border-primary bg-surface px-3 pb-3 pt-2.5">
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
                                  <Field key={ci} label={c.header} size="sm">
                                    {c.cell(row, ri)}
                                  </Field>
                                ))}
                              </FieldGrid>
                            )}
                          />
                        </div>
                      </td>
                    </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* `data-row-add` IS WHAT Tab STEERS BY. Enter or Tab off the last field
              LANDS on this button and a second Enter is what adds — the client's
              2026-08-19 reversal — and it needs no key handler: `enterAdvances`
              stands down on anything that is not an input/select/trigger, so the
              browser's native click fires. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-row-add
            className="w-32"
            onClick={() => {
              /* RULE 2b — "when a structured fabric like Rib is selected, its
                 component should automatically default to Neck".

                 IT IS NOT A RULE ABOUT RIBS. `solePanel` fills the cell only when
                 the style leaves exactly ONE panel available against this fabric,
                 which on the client's own tee is NECK under 1X1 LYCRA RIB and
                 nothing under Single Jersey (three panels, so nothing to default
                 to). A style that ribs a cuff as well gets two options and no
                 guess — and a guessed FK reads on screen exactly like a chosen
                 one.

                 COMPUTED AT THE MOMENT OF ADDING, over the panels already mapped,
                 so the third Add on a Single Jersey with two panels taken DOES
                 default to the one that is left — the client's rule 4, for free. */
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
          >
            + Add part
          </Button>
        </div>
  );
}
