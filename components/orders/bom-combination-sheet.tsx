"use client";

/**
 * Material BOM ▸ a line's COMBINATION sheet — one construction per garment panel.
 *
 * Client, 2026-08-19, and it is the sentence 0436 was written from:
 *
 *     "This allows the user to specify different thread colours or materials for
 *      individual Components (e.g. front, back, sleeve). It must allow for
 *      different Construction values (consumption rates) for each part, as a
 *      sleeve might use less thread than the front of the garment."
 *
 * So a navy body, red sleeves and a yellow collar are three thread colours on
 * one line, and the front seam consumes more than the collar does. The panels
 * are how the rate is ARRIVED AT; what survives into a purchase is COLOUR —
 * `colourSplits()` collapses same-coloured panels into one rate, because you do
 * not buy sleeve-thread and front-thread, you buy thread.
 *
 * ## IT IS OPT-IN PER LINE, AND IT IS NOT AN ATTRIBUTE
 *
 * The button opens on every line whatever the Attribute says (client
 * 2026-08-22). That is 0436's own design and it is deliberate twice over:
 *
 *   - making the panels a `requirement_basis` would force EVERY line onto the
 *     choice, which is the row multiplication 0423 was right to refuse — you
 *     need one collar interlining per garment whichever panel it is cut for;
 *   - `requirement_basis` already HAS a `combination` value meaning colour x
 *     size (0420), and it was withdrawn from the Attribute menu on 2026-08-21
 *     when the client settled that the Attribute picks ONE axis. Gating this
 *     sheet on it would put a third meaning on a word that already carries two.
 *
 * A line with no rows here behaves exactly as it always did — its own
 * `no_of_items` / `per_pieces` apply to the whole garment. That is what makes
 * this safe over lines already saved.
 *
 * ## Why a `Sheet`, and why that is not a style choice
 *
 * The button lives in a `ChildGrid` CELL, and `ChildGrid` wraps every cell in a
 * `RequiredScope`. That scope is React context, so it follows the RENDER tree —
 * a surface rendered from inside a mandatory cell would inherit "required",
 * stamp `data-required-empty` on every empty field it contains, and hold the
 * cursor while announcing the wrong field's name. `Sheet` resets the scope at
 * its portal boundary. It also registers with `lib/reload-guard.ts`, so a deploy
 * cannot silently reload the tab out from under a half-filled sheet; a
 * hand-rolled `fixed inset-0` div is invisible to that guard's DOM scan.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the parent's state, patched through `onChange` as they are typed,
 * exactly like the Style ▸ Process and Combos ▸ Structure Details overlays. The
 * BOM's own footer Save is what persists them. A local draft committed on
 * "Apply" would read as a second save inside a screen that already has one, and
 * would put the operator's work somewhere the unsaved-changes guard is not
 * looking.
 */

import { useMemo } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { Truncated } from "@/components/ui/truncated";
import { colourSplits, isRefusal } from "@/lib/orders/material-bom/requirement";
import { fmtNumber } from "@/lib/format";

/**
 * One panel row as the FORM holds it.
 *
 * THE FIGURES ARE STRINGS, matching every other numeric cell on this screen
 * (`moq`, `round_to`, the slice grid's boxes). A number in form state cannot
 * represent "the operator has cleared the box and is about to retype it", so it
 * fights the caret; the parse happens once, at the payload boundary.
 */
export type CombinationRow = {
  /**
   * The PARENT's key. Issued there, never grown here — these rows are re-keyed
   * when a BOM is loaded from the database, and a counter local to this sheet
   * would start at zero beside keys the parent had already issued and collide
   * the moment a saved line was reopened and added to.
   */
  key: string;
  component_id: string | null;
  /** NULL is "the line's own Item Color", never "no colour" — the inherit
   *  contract 0436 gives the column. */
  item_color_id: string | null;
  items: string;
  pieces: string;
};

/** A row the operator has begun — what makes its cells mandatory, and what
 *  stops "+ Add panel" stacking a second blank one. */
export function combinationRowStarted(r: CombinationRow): boolean {
  return !!r.component_id || !!r.item_color_id || !!r.items.trim() || !!r.pieces.trim();
}

export function BomCombinationSheet({
  open,
  onClose,
  lineLabel,
  styleLabel,
  lineRatio,
  lineColourName,
  rows,
  onChange,
  components,
  componentColours,
  colours,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The material this construction belongs to, for the sheet title. */
  lineLabel: string;
  /** The style the line names, or "" where it names none. */
  styleLabel: string;
  /** The line's own ratio, shown so the operator can see what the panels replace. */
  lineRatio: string;
  /** What a blank Trim Color inherits, NAMED rather than left to be guessed. */
  lineColourName: string;
  rows: CombinationRow[];
  onChange: (next: CombinationRow[]) => void;
  /**
   * THIS LINE'S STYLE'S OWN PANELS, already narrowed by the parent (0421 · 0423).
   *
   * Scoped there rather than here, per the cascading-picker rule: the screen is
   * what knows which style the line names and which components it declares. A
   * sheet handed the whole components master would offer a collar on a style
   * that has none — and `garment_style_components` is the only thing that knows
   * it does not.
   */
  components: PickerItem[];
  /** `component_id` -> the garment colours that panel is cut in on this order.
   *  A LIST, because a BOM line spans every combo — see `BomOrderStyle`. */
  componentColours: Record<string, string[]>;
  /**
   * The order's own palette, narrowed by the parent the same way the line's Item
   * Color cell is (client 2026-08-20). Takes the held value so a colour already
   * chosen survives a narrowing — the rule under "Disabled rows".
   */
  colours: (held: string | null) => PickerItem[];
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, next: Partial<CombinationRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * WHAT THIS SHEET ADDS UP TO, through the engine that will actually store it.
   *
   * `colourSplits` is the same function `requirementRows` calls on save, so the
   * summary cannot drift from the requirement. That divergence is not
   * hypothetical here: this module already shipped a line whose screen composed
   * its figures one way and whose server stored them another, and the stored one
   * is what a purchase order is checked against.
   *
   * It is also the only place the operator watches the collapse happen — two
   * panels of one colour become one rate — which is what tells them the sheet is
   * a construction and not a shopping list.
   */
  const summary = useMemo(() => {
    const parsed = rows
      .filter((r) => !!r.component_id)
      .map((r) => ({
        component_id: r.component_id as string,
        item_color_id: r.item_color_id,
        no_of_items: r.items.trim() === "" ? null : Number(r.items),
        per_pieces: r.pieces.trim() === "" ? null : Number(r.pieces),
        label: components.find((c) => c.id === r.component_id)?.name ?? "A panel",
      }));
    /* NULL as the fallback colour, deliberately: a blank panel stays blank here
       so the summary can print "Same as line" rather than resolving it to a name
       the operator never chose. The SERVER resolves it to the line's colour,
       which is where that decision belongs — the stored row has to carry a
       colour, and a summary does not. */
    return colourSplits(null, parsed);
  }, [rows, components]);

  const colourNameOf = (id: string | null) =>
    id ? (colours(id).find((c) => c.id === id)?.name ?? "—") : lineColourName || "Line colour";

  const columns: ChildGridColumn<CombinationRow>[] = [
    {
      header: "Component",
      width: "14rem",
      required: true,
      cell: (r) => (
        <RecordPicker
          label=""
          items={components}
          value={r.component_id}
          onChange={(id) => patch(r.key, { component_id: id })}
          disabled={readOnly}
          /* DECLARED TWICE ON PURPOSE. `ChildGridColumn.required` draws the
             header `*` and wraps the cell in a scope, but the stacked-cards
             layout renders a row WITHOUT that wrap — so a column declaring it
             beside a control that does not ships a star with nothing behind it.
             That is the exact star/hold divergence AGENTS.md's "Mandatory
             fields" section exists to make impossible, and four screens in this
             repo each rediscovered it independently. */
          required={combinationRowStarted(r)}
          /* Empty-and-explain, two ways. An empty list means the STYLE declares
             no panels — a real and fixable state — and a bare "— Select —"
             would report it as "the master has none", a different and more
             alarming thing to tell an operator. */
          placeholder={
            components.length
              ? "— Select Component —"
              : styleLabel
                ? "This style declares no components"
                : "Name a style on the line first"
          }
          compact
        />
      ),
    },
    {
      header: "Garment Color",
      width: "12rem",
      /**
       * INHERITED, NEVER TYPED — the Combos tab owns it
       * (`garment_order_amendment_combo_components.color_name`).
       *
       * A SECOND PLACE TO STATE IT WOULD BE A RIVAL RECORD of what colour the
       * sleeve is, and the two would agree only until one of them was edited.
       * That is why 0436 has no garment-colour column and this cell is text.
       *
       * IT IS A LIST BECAUSE THE QUESTION HAS NO SINGLE ANSWER HERE. A BOM panel
       * row belongs to a LINE, and a line spans every combo the order carries —
       * the front body is NAVY on the navy colourway and WHITE on the white one.
       * Printing one of them would be picking a combo arbitrarily and showing it
       * as fact.
       */
      cell: (r) => {
        const names = r.component_id ? (componentColours[r.component_id] ?? []) : [];
        return (
          <span className="text-sm text-muted-foreground">
            {/* Blank, not a dash: the Combos tab has simply not declared this
                panel yet, and a form cell is not a table cell (the de-clutter
                rule, 2026-08-17). */}
            {names.length ? <Truncated text={names.join(", ")} /> : null}
          </span>
        );
      },
    },
    {
      header: "Trim Color",
      width: "14rem",
      /**
       * WHICH THREAD GOES ON THIS PANEL — the one thing here that changes what is
       * BOUGHT, which is why it survives into a requirement row while the panel
       * beside it does not (0436 · 0454).
       *
       * NOT `required`. Blank means "the line's own Item Color", which is the
       * ORDINARY case — the parts differ only in how much they consume — and the
       * placeholder names it so the inheritance is visible rather than implied.
       * Requiring it would put the cursor hold on the common answer.
       */
      cell: (r) => (
        <RecordPicker
          label=""
          items={colours(r.item_color_id)}
          value={r.item_color_id}
          onChange={(id) => patch(r.key, { item_color_id: id })}
          disabled={readOnly}
          placeholder={lineColourName ? `Same as line (${lineColourName})` : "Same as the line"}
          compact
        />
      ),
    },
    {
      header: "No. of Items",
      align: "right",
      width: "8rem",
      required: true,
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.items}
          disabled={readOnly}
          required={combinationRowStarted(r)}
          aria-label="Number of items on this panel"
          onChange={(e) => patch(r.key, { items: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Per Pieces",
      align: "right",
      width: "8rem",
      required: true,
      /* NEVER DEFAULTED TO 1 — not in the column (0436 CHECKs it `> 0`), not in
         `mbaItemComponentInput`, not here. A default makes an unfinished panel
         compute, and the rate it produces is summed into a figure a purchase
         order is written from. 0418 states the same rule for the line itself. */
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.pieces}
          disabled={readOnly}
          required={combinationRowStarted(r)}
          aria-label="Pieces this panel's items cover"
          onChange={(e) => patch(r.key, { pieces: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* `lg` for the reason the Process sheet records at length: at `sm` the
         `ChildGrid` inside falls back to stacked cards and drops its column
         headers, so five labelled cells render as five unlabelled boxes. A
         surface's size is a function of what is ON it, not of how it was opened.
         `fullBleed` removes the reading-width inset; the two answer different
         questions and this surface needs both answered. */
      size="lg"
      fullBleed
      /* Above the BOM's own editor overlay — this opens from a grid cell inside
         it, and a nested sheet needs the higher base to stack reliably. */
      zIndexBase={120}
      title={lineLabel ? `Combination — ${lineLabel}` : "Combination"}
      footer={<SubSheetFooter onDone={onClose} parent="material BOM" />}
    >
      {/* THE LINE, READ-ONLY. The sheet covers the screen, so once it is open
          there is nothing left to say which of the grid's lines these panels
          belong to. `readOnly` and not `disabled`: `Input` sets `tabIndex={-1}`
          on a readOnly field itself, so these leave the Tab path without a
          per-screen opt-out. */}
      <FieldRow>
        <Field label="Material" w="name">
          <Input value={lineLabel} readOnly />
        </Field>
        <Field label="Style" w="term">
          <Input value={styleLabel} readOnly />
        </Field>
        <Field label="Line Ratio" w="range">
          <Input value={lineRatio} readOnly />
        </Field>
      </FieldRow>

      <ChildGrid
        columns={columns}
        rows={rows}
        onAdd={() => {
          if (readOnly) return false;
          /* DECLINES ON A BLANK ROW rather than stacking a second one. The grid
             lands the cursor in whatever row it adds (`landOnAddedRow`), and a
             refusal that adds no field moves nothing — so the decline stays
             visible instead of being papered over by a cursor jump. */
          const last = rows[rows.length - 1];
          if (last && !combinationRowStarted(last)) return false;
          onChange([
            ...rows,
            { key: newKey(), component_id: null, item_color_id: null, items: "", pieces: "" },
          ]);
        }}
        onRemove={(row) => onChange(rows.filter((r) => r.key !== row.key))}
        addLabel="+ Add panel"
        hideRemove={readOnly}
      />

      {/* WHAT THE PANELS COME TO, through the engine that stores them. Not
          decoration: it is where the operator sees two panels of one colour
          collapse into one rate, which is the difference between this sheet and
          a shopping list. A refusal is PRINTED — `colourSplits` names the panel
          it is about — because a summary that silently vanishes when one row is
          half-typed reads as "nothing to say". */}
      {rows.length > 0 && (
        <div className="mt-3 text-sm">
          {isRefusal(summary) ? (
            <span className="text-destructive">{summary.refused}</span>
          ) : summary.length ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-muted-foreground">
              <span className="font-medium text-foreground">Per garment:</span>
              {summary.map((s) => (
                <span key={s.item_color_id ?? ""}>
                  {colourNameOf(s.item_color_id)} {fmtNumber(s.no_of_items)}
                  <span className="text-xs">
                    {" "}
                    ({s.component_ids.length}{" "}
                    {s.component_ids.length === 1 ? "panel" : "panels"})
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
