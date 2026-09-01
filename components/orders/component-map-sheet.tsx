"use client";

/**
 * Orders ▸ Fabric BOM ▸ Components — the [Detail] sheet (0495).
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
 * mandatory) — four holds for one answer.
 */

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGrid } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { RecordPicker } from "@/components/masters/record-picker";
import { Truncated } from "@/components/ui/truncated";
import { gridKeyNav } from "@/components/masters/child-grid";
import {
  FABRIC_FORM_OPTIONS,
  availablePanels,
  declaredPanelsFor,
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

/** One panel of the fabric, with the lines (one per colourway) that carry it. */
type PanelGroup = {
  /** The panel's own key — its component id, or a placeholder for an unmapped row. */
  key: string;
  component_id: string | null;
  coordinate_id: string | null;
  fabric_form: string;
  lines: MapLine[];
};

export function ComponentMapSheet({
  open,
  onClose,
  /** The fabric being mapped — its label, and the lines that make it up. */
  title,
  lines,
  decls,
  components,
  coordinates,
  /** The order's declared colours and prints, for the two auto-filled cells. */
  colourOptions,
  printOptions,
  structureId,
  styleRefNo,
  /** Every line of the BOM, so rule 3 can see panels taken on OTHER fabrics. */
  allLines,
  onPatchPanel,
  onPatchLine,
  onAddPanel,
  onRemovePanel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: MapLine[];
  decls: readonly StyleComponentDecl[];
  components: readonly PickerRow[];
  coordinates: readonly PickerRow[];
  colourOptions: readonly string[];
  printOptions: readonly string[];
  structureId: string | null;
  styleRefNo: string;
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
   * WHETHER THE ORDER HAS DECLARED ANYTHING AT ALL AGAINST THIS FABRIC.
   *
   * The distinction the rule module deliberately does not encode in its return
   * value, made here where there is room to say it in words. An empty option
   * list means one of two things and only one of them is a success:
   *
   *   · every panel is mapped — the client's own "the selection list should
   *     display as empty", and nothing is wrong;
   *   · the ORDER declares no panel against this fabric category — a problem to
   *     fix on Order Entry, and one that reads exactly like the first.
   *
   * AGENTS.md names this failure under cascading filters: "the failure is
   * indistinguishable from a legitimate result, so it gets believed rather than
   * reported." One `declaredPanelsFor` call separates them.
   */
  const declaredCount = useMemo(
    () => declaredPanelsFor(decls, styleRefNo, structureId).length,
    [decls, styleRefNo, structureId],
  );

  const componentName = (id: string | null) =>
    components.find((c) => c.id === id)?.name ?? null;
  const coordinateName = (id: string | null) =>
    coordinates.find((c) => c.id === id)?.name ?? null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      /* CLEARS THE FULL-SCREEN EDITOR BENEATH IT, the same base the Structure
         Details overlay uses one module along. */
      zIndexBase={120}
    >
      <div className="space-y-4">
        {/* THE ONE STANDING SENTENCE ON THIS SURFACE, and it is conditional.
            `SectionBody`'s `hint` prop was removed with all 51 call sites on
            2026-08-17 — a heading gets no standing sentence — and the surviving
            exceptions render only while the state they describe is true. This
            one is the "empty and explain" half of the rule above: without it a
            fabric the order has declared no panel against is a sheet with an
            empty dropdown and nothing to say where the answer lives. */}
        {declaredCount === 0 && (
          <p className="text-xs text-warning">
            This order declares no panel cut from this fabric. Add one on Order
            Entry ▸ Style(s) ▸ Components, against this structure, and it will be
            offered here.
          </p>
        )}

        <div
          /* THE FOUR DOM MARKERS ARE THE WHOLE KEYBOARD CONTRACT. `ChildGrid`
             has no row-detail slot, so a nested grid is markup the caller emits
             (the Combos ▸ Structure Details overlay says the same). `gridKeyNav`
             must sit on the SAME element as `data-grid-body` because it reads
             `e.currentTarget`. */
          data-grid-body
          className="space-y-3"
          onKeyDown={(e) => gridKeyNav(e)}
        >
          {panels.map((p, i) => {
            /* RULE 2 + RULE 3, THROUGH THE ONE FUNCTION. Siblings are the OTHER
               panels of the whole BOM — never this one — so a panel can never
               filter itself out of its own list. */
            const options = availablePanels({
              decls,
              siblings: allLines.filter(
                (l) => !p.lines.some((x) => x.key === l.key),
              ),
              styleRefNo,
              structureId,
              held: p.component_id,
            });
            /* THE MASTER'S OWN ROWS, NARROWED — never rows rebuilt from the
               ids. `getComponentRows` already resolved `inactive` off the
               `components` table (which spells the flag `inactive`, not
               `is_active`, and has done since 0299), and reconstructing a row
               here would hand `RecordPicker` a fresh object whose flag was
               whatever this file remembered to copy. AGENTS.md's "Disabled
               rows" says the same thing from the other end — "adapters pass
               `inactive`; `RecordPicker` call sites just pass the row" — and
               `--check picker-inactive` catches exactly this reconstruction.

               A PANEL THE MASTER NO LONGER HAS IS STILL SHOWN, tagged. It can
               only be one this line already holds (`availablePanels` offers
               nothing else unknown), and dropping it would render a filled cell
               empty and blank the FK on the next save — the same data loss the
               flag rule exists to prevent, arriving through a missing row
               instead of a switched-off one. */
            const items: PickerRow[] = options.map(
              (o) =>
                components.find((c) => c.id === o.component_id) ?? {
                  id: o.component_id,
                  code: null,
                  name: "(panel no longer in the master)",
                  /* `true`, AND THAT IS THE HONEST ANSWER rather than a way to
                     quiet the check. This branch is only reached for a panel
                     the line already HOLDS, so the "Disabled rows" rule applies
                     to it word for word: "it stays on the field, greyed and
                     tagged, and cannot be re-picked." Marking it inactive is
                     what makes `RecordPicker` do all three. */
                  inactive: true,
                },
            );

            return (
              <div
                key={p.key}
                data-grid-row
                /* A RAIL, NOT A CARD. The sheet already draws the box; a border
                   per panel is the third frame the client removed on the Combos
                   overlay ("remove that structure details frame also, one frame
                   is enough"). The rail says where a panel begins. */
                className="relative border-l-2 border-primary pl-4"
              >
                <FieldGrid>
                  {/* THE LABELS RIDE THE FIRST PANEL ONLY (client 2026-08-17:
                      "no need to show this ... fields title for everytime because
                      making screen two huge"). `Field` draws no label row at all
                      when `label` is omitted — as opposed to `label=""`, which
                      RESERVES it. The controls keep their own `label` prop, so
                      the accessible name and the hold's message survive on every
                      row. */}
                  <Field label={i === 0 ? "Component" : undefined} required size="sm">
                    <RecordPicker
                      label="Component"
                      compact
                      required
                      items={items}
                      value={p.component_id}
                      onChange={(id) =>
                        onPatchPanel(p.key, {
                          component_id: id,
                          /* THE COORDINATE COMES WITH THE PANEL and is never
                             picked separately. The order's declaration pairs
                             them, so asking twice is asking the operator to
                             restate something they have already said — and to
                             get it wrong. Null when the panel is cleared, which
                             is the only way this cell is ever emptied. */
                          coordinate_id:
                            options.find((o) => o.component_id === id)?.coordinate_id ??
                            null,
                        })
                      }
                    />
                  </Field>

                  {/* COORDINATE IS SHOWN AND NOT EDITED. Legacy prints it as a
                      cell and it is real information — PIECES vs TOP tells two
                      identically-named panels apart — but it is a property OF
                      the chosen component here, so an editable box would be a
                      second place for it to disagree with the order. Read-only
                      TEXT rather than `<Input readOnly>`: nothing is typed, so
                      nothing should be a tab stop. */}
                  <Field label={i === 0 ? "Coordinate" : undefined} size="sm">
                    <div className="flex min-h-8 items-center">
                      <Truncated className="text-sm text-muted-foreground">
                        {coordinateName(p.coordinate_id) ?? "—"}
                      </Truncated>
                    </div>
                  </Field>

                  <Field label={i === 0 ? "Open / Tubular" : undefined} required size="sm">
                    {/* MANDATORY, AND THE STAR COMES FROM THE SAME DECLARATION
                        THE SAVE GATE DOES — `fabricBomLineInput` refuses a line
                        with a fabric and no form, `Field required` draws the `*`
                        and stamps `data-required-empty`, and the cursor holds.
                        One declaration, four enforcers (AGENTS.md). */}
                    <Select
                      compact
                      className="h-8"
                      required
                      value={p.fabric_form}
                      onChange={(e) =>
                        onPatchPanel(p.key, { fabric_form: e.target.value })
                      }
                    >
                      <option value="" />
                      {FABRIC_FORM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FieldGrid>

                {/* THE COLOURWAYS OF THIS PANEL. One row per line, and the count
                    is what makes the fan-out visible: mapping a panel here wrote
                    this many rows, and the operator can see them. */}
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {p.lines.map((l, j) => (
                    <FieldGrid key={l.key}>
                      {/* THE ASSORT COLOUR IS THE ORDER'S AND IS NOT EDITED
                          here — it is the line's `combo`, editable on the Fabric
                          Lines grid where the line's identity lives. Changing it
                          in here would move the line to another fabric while the
                          operator was looking at this one. */}
                      <Field label={j === 0 ? "Assort colour" : undefined} size="sm">
                        <div className="flex min-h-8 items-center">
                          <Truncated className="text-sm">{l.combo || "—"}</Truncated>
                        </div>
                      </Field>
                      <Field label={j === 0 ? "Required colour" : undefined} size="sm">
                        {/* A COMBOBOX OVER THE ORDER'S OWN DYEING LIST, so the
                            cell PICKS what earlier screens declared rather than
                            accepting a fifth spelling of WHITE. `clearable`
                            because a panel with no stated colour is an ordinary
                            document. Typed text in a Combobox is a search and is
                            never committed — see `commit` in combobox.tsx. */}
                        <Combobox
                          compact
                          inputClassName="h-8"
                          options={colourOptions.map((c) => ({ value: c, label: c }))}
                          value={l.color_name}
                          onChange={(v) => onPatchLine(l.key, { color_name: v })}
                          clearable
                        />
                      </Field>
                      <Field label={j === 0 ? "Required print" : undefined} size="sm">
                        <Combobox
                          compact
                          inputClassName="h-8"
                          options={printOptions.map((c) => ({ value: c, label: c }))}
                          value={l.required_print}
                          onChange={(v) => onPatchLine(l.key, { required_print: v })}
                          clearable
                        />
                      </Field>
                      <Field label={j === 0 ? "Specification" : undefined} size="lg">
                        <Input
                          className="h-8"
                          value={l.specification}
                          onChange={(e) =>
                            onPatchLine(l.key, { specification: e.target.value })
                          }
                        />
                      </Field>
                    </FieldGrid>
                  ))}
                </div>

                {/* `data-row-remove` IS WHAT Ctrl+Del DRIVES — the grid finds the
                    row's own ✕ by this marker and clicks it, which is how a panel
                    is removed from the keyboard now that Tab lands on fields
                    only (AGENTS.md, "Delete a grid row"). */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-row-remove
                  /* NO `tabIndex={-1}`. Tab skips non-fields on every surface
                     already — `cycleTab` in lib/focus.ts, delivered by the one
                     document listener — so a tabIndex here would be the
                     per-component patch for a contract-level rule AGENTS.md
                     bans by name ("a per-component fix for a contract-level rule
                     always leaves a remainder"). It also removes the ✕ from
                     SCREEN-READER focus order, which the rule is explicit about
                     keeping: the ✕ is reordered out of the typing path, never
                     out of the document. Ctrl+Del drives it via `data-row-remove`. */
                  aria-label={`Remove ${componentName(p.component_id) ?? "panel"}`}
                  className="absolute right-0 top-0 text-danger hover:text-danger"
                  onClick={() => onRemovePanel(p.key)}
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>

        {/* `data-row-add` IS WHAT Tab STEERS BY. Enter or Tab off the last field
            LANDS on this button and a second Enter is what adds — the client's
            2026-08-19 reversal, and it needs no handler here: `enterAdvances`
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
               default to the one that is left. That is the same rule doing the
               client's rule 4 work for free. */
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
    </Sheet>
  );
}
