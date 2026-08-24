"use client";

/**
 * THE COMBINATION POPUP — S No AND A TYPED NAME, AND NOTHING ELSE.
 *
 * Client, 2026-08-24, with the legacy dialog beside ours:
 *
 *     "we need to redesign the combination screen just with the legacy ...
 *      inside screen Combination Details inside only S No, Combination — these
 *      fields only. That S No is automatic and Combination free text."
 *
 * and again, on being shown this sheet as it then stood (screenshot 2481):
 *
 *     "i told this screen only going to be get sno and combination field as
 *      free text update it"
 *
 * So the popup collects NAMES. The operator types TOP, BOTTOM, NECK RIB, presses
 * Done, and the LINE splits — one sub-row per name, exactly the way picking an
 * Attribute value splits it. The figures each part needs (Item Color,
 * Specification, No of Items, No of Pcs, Allowance) are filled in that split,
 * out in the listing, and deliberately not here.
 *
 * ## IT ONLY DISPLAYS AFTER VALUES ARE GIVEN (client 2026-08-24)
 *
 *     "that combination is only display after give that value not static field"
 *
 * A line with no combinations is the ORDINARY line: no split rows, its own single
 * ratio applies, and nothing about it changes. That is the same opt-in-per-line
 * property 0436 was built with ("a line with no panels is the ordinary line"),
 * and it is what lets this be added without re-meaning a single existing row.
 *
 * ## WHAT THIS REPLACED, AND WHY THE OLD REASONING IS KEPT
 *
 * Until 2026-08-24 this sheet was a per-panel CONSTRUCTION editor: Component (an
 * FK into the components master) / Garment Color / Trim Color / No. of Items /
 * Per Pieces, summed by `colourSplits` into a rate per trim colour. That design
 * was put to the client on 2026-08-23 against legacy's name list and explicitly
 * chosen — "'Combination' IS the Per-Panel Construction ... mapping contrast
 * components to specific dyed trim colors and distinct consumption rates" — and
 * the ruling was reversed the following day in favour of legacy.
 *
 * The superseded reasoning is recorded rather than deleted, the way 0431 kept
 * 0402's. A later reader comparing this to the panel editor is looking at a
 * decision that was made twice, not at an unfinished port.
 *
 * ONE CLAIM IN THAT RULING WAS WRONG, and it is corrected here so it does not
 * get quoted forward: reverting to a name list does NOT "silently un-read
 * `colourSplits`". Item Color rides on the SPLIT ROW (0449), so trim colour
 * still reaches a requirement row and MOQ-per-cone-colour still groups the way
 * `bomCeilingForOrder` needs — it reads slices instead of components. The real
 * exposure was elsewhere, and it is the one below.
 *
 * ## THE NAME IS NOT `combo`, AND THAT IS THE WHOLE TRAP (0463)
 *
 * `material_bom_amendment_item_slices` already has a `combo` column and it means
 * something else — 0442 says so in the column comment itself: "the colourway BY
 * NAME ... a name on the Combos tab, not a lookup row". Three things join on it:
 * the option list narrows to the ORDER's combos for the line's style, `colourOf`
 * reads it as the garment colour on a colour-wise line, and `compose.ts` matches
 * assort rows to a slice through `comboKey`.
 *
 * A colourway is CHOSEN from a controlled list; a Combination is TYPED. Putting a
 * typed TOP into a column the composer joins on by name does not error — it
 * silently matches nothing, which is the drift AGENTS.md records under Nominated
 * vendors, where two spellings of one supply type compiled, ran and matched
 * nothing. So 0463 gives Combination its own column beside `combo`, and both
 * survive on one row: a RED/WHITE colourway split TOP/BOTTOM.
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
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";

/**
 * One typed combination as the FORM holds it.
 *
 * There is no `sno` here on purpose: `ChildGrid` numbers its own rows, so a
 * serial carried in state would be a second copy of a fact the grid already
 * renders — and one that goes wrong the moment a middle row is removed. The
 * stored `sno` is assigned from array order at the payload boundary.
 */
export type CombinationRow = {
  /**
   * The PARENT's key. Issued there, never grown here — these rows are re-keyed
   * when a BOM is loaded from the database, and a counter local to this sheet
   * would start at zero beside keys the parent had already issued and collide
   * the moment a saved line was reopened and added to.
   */
  key: string;
  combination: string;
};

/** A row the operator has begun — what stops "+ Add" stacking a second blank
 *  one, and what the payload boundary keeps. */
export function combinationRowStarted(r: CombinationRow): boolean {
  return !!r.combination.trim();
}

/**
 * The stored form of a typed name.
 *
 * EXACT TEXT, NOT CASE-FOLDED, because that is what the unique index compares:
 * `coalesce(combination, '')` in `uq_mba_slice_line_combo_size` (0463). Folding
 * case here would make the screen reject a pair the database accepts — one layer
 * refusing what the other allows is as wrong as the reverse, and the duplicate
 * rule exists to keep the two halves agreeing.
 *
 * It needs no `toUpperCase()` of its own: `Input` capitalises every keystroke by
 * default (AGENTS.md, CAPITALS), so a typed name is already in capitals and two
 * spellings of one part cannot differ by case in the first place.
 */
export function combinationKey(name: string): string {
  return name.trim();
}

export function BomCombinationSheet({
  open,
  onClose,
  categoryLabel,
  typeLabel,
  itemLabel,
  attributeLabel,
  lineRatio,
  rows,
  onChange,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /* THE LINE, READ-ONLY, IN LEGACY'S OWN ORDER — Category, Type, Item,
     Attribute, and the line's figure. The sheet covers the screen, so once it is
     open there is nothing else left to say which line these names belong to. */
  categoryLabel: string;
  typeLabel: string;
  /** The material this belongs to. Also the sheet title. */
  itemLabel: string;
  attributeLabel: string;
  /** The line's own ratio, shown so the operator can see what the split refines. */
  lineRatio: string;
  rows: CombinationRow[];
  onChange: (next: CombinationRow[]) => void;
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, next: Partial<CombinationRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * THE FIRST REPEATED NAME, or null.
   *
   * Not a nicety: `uq_mba_slice_line_combo_size` (0463) keys a split row on the
   * combination, so a second TOP is a unique violation — and an unguarded one
   * surfaces at Save as a raw Postgres constraint string, a stack trace where a
   * sentence belongs. That is the failure `ManageConfig.dupCheck` was added to
   * this repo to stop.
   *
   * Answered SYNCHRONOUSLY, in the same render as the keystroke, because the
   * rows are already here — the reason AGENTS.md gives for preferring
   * `useDuplicateName` over the async `useDuplicateCheck` on a screen that holds
   * its own rows. There is nothing to ask a server.
   */
  const duplicate = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = combinationKey(r.combination);
      if (!k) continue;
      if (seen.has(k)) return k;
      seen.add(k);
    }
    return null;
  }, [rows]);

  const columns: ChildGridColumn<CombinationRow>[] = [
    {
      header: "Combination",
      /* The row IS this field, so it gets the room. There is no second column to
         share the width with, and a garment part is a phrase ("NECK RIB",
         "FRONT PLACKET"), not a code. */
      width: "24rem",
      required: true,
      cell: (r) => (
        <Input
          value={r.combination}
          disabled={readOnly}
          /* DECLARED TWICE ON PURPOSE. `ChildGridColumn.required` draws the
             header `*` and wraps the cell in a scope, but the stacked-cards
             layout renders a row WITHOUT that wrap — so a column declaring it
             beside a control that does not ships a star with nothing behind it.
             That is the star/hold divergence AGENTS.md's "Mandatory fields"
             section exists to make impossible, and four screens in this repo
             each rediscovered it independently.

             UNCONDITIONAL, unlike the panel editor this replaced. That one gated
             on "has the operator begun this row?", which had four other cells to
             answer it; here the row is the one field, so the same gate would
             read `required={!!r.combination}` — true only once it is filled,
             which is precisely when a hold has nothing left to do. Escape still
             leaves, as it does under every hold. */
          required
          aria-label="Combination name"
          /* NOT `uppercase`-flagged: `Input` capitalises by default since
             2026-08-18, and `combinationKey` depends on that being true. */
          onChange={(e) => patch(r.key, { combination: e.target.value })}
          placeholder="e.g. TOP"
          className="h-8"
        />
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* `lg`, and `sm` is not the tempting alternative it looks like. A surface's
         size is a function of what is ON it, and one text column wants less
         width than five cells did — but `Sheet` offers only `sm` and `lg`, and
         at `sm` the `ChildGrid` inside falls back to stacked cards and drops its
         column headers. That would leave the one field on this screen as an
         unlabelled box, which is worse than a dialog wider than it needs. */
      size="lg"
      /* Above the BOM's own editor overlay — this opens from a grid cell inside
         it, and a nested sheet needs the higher base to stack reliably. */
      zIndexBase={120}
      title={itemLabel ? `Combination — ${itemLabel}` : "Combination"}
      footer={<SubSheetFooter onDone={onClose} parent="material BOM" />}
    >
      {/* `readOnly` and not `disabled`: `Input` sets `tabIndex={-1}` on a
          readOnly field itself, so these leave the Tab path without a per-screen
          opt-out, and Tab goes straight to the one field that is typed here. */}
      <FieldRow>
        <Field label="Category" w="term">
          <Input value={categoryLabel} readOnly />
        </Field>
        <Field label="Type" w="term">
          <Input value={typeLabel} readOnly />
        </Field>
        <Field label="Item" w="name">
          <Input value={itemLabel} readOnly />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Attribute" w="term">
          <Input value={attributeLabel} readOnly />
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
          onChange([...rows, { key: newKey(), combination: "" }]);
        }}
        onRemove={(row) => onChange(rows.filter((r) => r.key !== row.key))}
        addLabel="+ Add combination"
        hideRemove={readOnly}
      />

      {/* NAMES THE REPEAT rather than saying "duplicate found". The operator has
          a list in front of them, and the whole job of the message is to say
          which line to look at. */}
      {duplicate && (
        <div className="mt-3 text-sm text-destructive">
          {duplicate} is listed twice — each combination can appear once on a line.
        </div>
      )}
    </Sheet>
  );
}
