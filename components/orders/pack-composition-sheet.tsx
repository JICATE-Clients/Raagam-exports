"use client";

/**
 * Order Info ▸ Style(s) ▸ Pack Composition — what one retail SET pack holds.
 *
 * Client, recording of 2026-08-25: "planners must configure the set's contents
 * inside a compulsory Pack Composition sub-grid … map the coordinate pieces
 * (e.g. Top and Bottom) to specific colors". The commercial order is booked in
 * packs; this is what turns a pack into garments (0467).
 *
 * ## Why a `Sheet`, and why that is not a style choice
 *
 * The opener lives in a `ChildGrid` CELL, and `ChildGrid` wraps every cell in a
 * `RequiredScope`. That scope is React context, so it follows the RENDER tree —
 * a surface rendered from inside the cell would inherit "required" and stamp
 * `data-required-empty` on every empty field it contains, holding the cursor
 * and announcing the wrong field's name. That is the New Yarn bug AGENTS.md
 * records (client 2026-08-06). `Sheet` resets the scope at its portal boundary.
 *
 * It also registers with `lib/reload-guard.ts`, so a deploy cannot silently
 * reload the tab out from under a half-filled composition — which a hand-rolled
 * `fixed inset-0` div could not do, the guard's DOM scan being unable to see it.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the parent's state, patched through `onChange` as they are
 * typed, exactly like every other child grid on this screen. The amendment's
 * own footer Save is what persists them — and on a NEW order there is no
 * amendment id to commit them against, so a Save here could not mean anything.
 * `SubSheetFooter` says so rather than leaving an ✕ to be interpreted as
 * "missing save button", which is how this was reported on the Process sheet
 * (client 2026-08-14).
 */

import { useMemo } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { fmtNumber } from "@/lib/format";
import {
  packMemberKey,
  packRowStarted,
  piecesPerPack,
  derivedPoQty,
  type PackComponentRow,
} from "@/lib/orders/amendments/pack-composition";

/** A garment the set may hold — `items` of item class GAR, as Coordinates. */
export type CoordinateOption = { id: string; code: string | null; name: string };

export function PackCompositionSheet({
  open,
  onClose,
  styleLabel,
  rows,
  onChange,
  coordinates,
  combos,
  packsOrdered,
  newKey,
  readOnly = false,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  /** The style this pack belongs to, for the sheet title. */
  styleLabel: string;
  rows: PackComponentRow[];
  onChange: (next: PackComponentRow[]) => void;
  /**
   * THIS ORDER'S coordinates, already narrowed by the parent.
   *
   * Scoped there rather than here, per the cascading-picker rule: the screen is
   * what knows which style this line names and which coordinates it declares. A
   * sheet handed the whole GAR item class would offer a BOTTOM on a style that
   * is a single tee — and the style's own coordinate list is the only thing
   * that knows it is not.
   */
  coordinates: CoordinateOption[];
  /**
   * The colourways declared for THIS style on the Combos tab, by value.
   *
   * By value and not by id, the 0413 / 0433 convention: a combo row's id is
   * rewritten by every `writeChildren` pass, so an id stored here would point
   * at a row that does not exist after the next Save.
   */
  combos: string[];
  /** The pack count on the style line, so the sheet can show what it explodes to. */
  packsOrdered: string;
  /**
   * The PARENT's key generator, passed in rather than grown here.
   *
   * These rows live in the parent's state and are re-keyed there when an
   * amendment is loaded from the database, so a counter local to this sheet
   * would start at zero beside keys the parent had already issued and collide
   * the moment a saved composition was reopened and added to.
   */
  newKey: () => string;
  readOnly?: boolean;
  /** The rect of the cell's button, so the box grows out of it — the same
   *  prop `StyleProcessSheet` takes, for the same reason. */
  origin?: SheetOrigin | null;
}) {
  const patch = (key: string, next: Partial<PackComponentRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * (coordinate, colour) pairs already taken — the screen's copy of 0467's
   * unique index.
   *
   * NOT a flat set of coordinate ids, and that is the rule rather than a
   * refinement: a 3-pack of bodysuits is legitimately the SAME coordinate three
   * times in three colours, and a flat set would withhold the second and third
   * with no explanation on a screen where they are the correct entry — the
   * client's own worked example, refused.
   */
  const taken = useMemo(() => {
    const m = new Set<string>();
    for (const r of rows) if (packRowStarted(r)) m.add(packMemberKey(r));
    return m;
  }, [rows]);

  const per = piecesPerPack(rows);
  const pieces = derivedPoQty(rows, packsOrdered);

  const columns: ChildGridColumn<PackComponentRow>[] = [
    {
      header: "Coordinate",
      width: "16rem",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Coordinate"
          items={coordinates}
          value={r.coordinate_id}
          onChange={(id) => patch(r.key, { coordinate_id: id })}
          disabled={readOnly}
          /* DECLARED ON THE CONTROL AS WELL AS THE COLUMN. `ChildGrid`'s
             stacked-cards layout calls `renderMobileRow` INSTEAD of the
             `columns.map()` that wraps each cell in a `RequiredScope`, so
             `ChildGridColumn.required` draws the header star and reaches no
             control — a star with nothing behind it. AGENTS.md records four
             screens that each rediscovered this independently; this is the
             fifth, written down rather than rediscovered. */
          required
          /* Empty-and-explain, never a bare "— Select —". An empty list here has
             one cause and it is fixable, so it says where to go; reporting it as
             "no coordinates" would read as a broken master. */
          placeholder={
            coordinates.length
              ? "— Select Coordinate —"
              : "Add coordinates on the style line first"
          }
          compact
        />
      ),
    },
    {
      header: "Colour",
      width: "14rem",
      /**
       * WHICH COLOURWAY THIS MEMBER IS MADE IN — the axis that makes a 3-pack a
       * 3-pack rather than three of the same thing.
       *
       * A `Combobox` over the style's declared combos rather than a picker: the
       * value is stored BY VALUE (see the prop note above), and an operator may
       * legitimately name a colourway the Combos tab has not caught up with. It
       * is a suggestion list, not a whitelist.
       *
       * NOT `required`. A pyjama set whose two pieces are both the one colourway
       * is entered by leaving this blank, and requiring it would hold the cursor
       * on a cell that has no answer on the ordinary order.
       */
      cell: (r) => (
        <Combobox
          value={r.combo}
          onChange={(v) => patch(r.key, { combo: v })}
          options={combos.map((c) => ({ value: c, label: c }))}
          disabled={readOnly}
          placeholder={combos.length ? "" : "No colourways declared yet"}
        />
      ),
    },
    {
      header: "Qty / pack",
      width: "9rem",
      align: "right",
      required: true,
      /**
       * HOW MANY OF THIS GARMENT ARE IN ONE PACK. Usually 1; a 3-pack of one
       * colour is 3.
       *
       * The pack's SIZE is the sum of this column and has no field of its own —
       * a field for a sum is a second source of truth for an addition, the same
       * test that kept `pcs_per_pack` off the assortment line twice.
       */
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="1"
          className="h-8 text-right"
          value={r.qty_per_pack}
          disabled={readOnly}
          required={packRowStarted(r)}
          onChange={(e) => patch(r.key, { qty_per_pack: e.target.value })}
        />
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* `md`, NOT `lg` + `fullBleed` (AGENTS.md, "A sub-detail Sheet's size",
         STANDING, 2026-09-03). This sheet used to claim it matched Process's
         own choice — it did not: `StyleProcessSheet` is `size="md"` +
         `alignToPane` + `origin`, and always has been since it was restored
         on 2026-08-29. The `ChildGrid` reasoning that comment cited is real
         (`sm`'s ~408px drops the grid to stacked cards below `@lg`'s 512px,
         the Process sheet's own 2026-08-12 defect) — it argues for `md` over
         `sm`, which is what this now is; it never argued for `lg`. This
         surface's three columns (16rem + 14rem + 9rem, ~624px) fit `md`'s
         ~1112px of content with room to spare. */
      size="md"
      /* CENTRED OVER THE CONTENT PANE, and GROWS OUT OF THE BUTTON THAT
         OPENED IT — the same two props Style ▸ Process sets, same reason. */
      alignToPane
      origin={origin}
      zIndexBase={120}
      title={styleLabel ? `Pack Composition — ${styleLabel}` : "Pack Composition"}
      footer={<SubSheetFooter onDone={onClose} />}
    >
      <div className="space-y-4">
        <ChildGrid<PackComponentRow>
          columns={columns}
          rows={rows}
          /* `onAdd` is required by `ChildGrid`, so read-only DECLINES rather
             than omitting it — returning false is the grid's own "this grid
             cannot grow" answer, which is also what makes Enter-off-the-last-row
             bubble to the parent instead of dying here. */
          onAdd={() => {
            if (readOnly) return false;
            onChange([
              ...rows,
              { key: newKey(), coordinate_id: null, combo: "", qty_per_pack: "1" },
            ]);
          }}
          onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
          addLabel="+ Add pack member"
        />

        {/**
         * THE EXPLOSION, SAID ONCE, WHERE IT IS BEING DECIDED.
         *
         * The operator types in this grid and the consequence — the piece count
         * the whole factory works to — appears on a different tab. That is the
         * proximity defect the Assortments overlay was reported for (client
         * screenshot 2412: the rule was never missing, the only reaction was at
         * the bottom of a different surface). So the arithmetic states itself
         * here, beside the caret.
         *
         * ALWAYS ON, not only when something is wrong: "3 pieces per pack" is
         * the number the operator is checking WHILE typing, and a figure that
         * appears only after a mistake cannot prevent one.
         *
         * A dash, never a 0, while it cannot be worked out — `derivedPoQty`
         * returns null for exactly that, and a zero here would read as an order
         * for nothing.
         */}
        <p className="text-xs text-muted-foreground">
          {per > 0 ? (
            <>
              <span className="font-medium text-foreground">{fmtNumber(per)}</span>{" "}
              {per === 1 ? "piece" : "pieces"} per pack
              {pieces == null ? (
                <> · enter the pack count on the style line to get the PO Qty</>
              ) : (
                <>
                  {" "}
                  × {fmtNumber(Number(packsOrdered) || 0)} packs ={" "}
                  <span className="font-medium text-foreground">{fmtNumber(pieces)}</span>{" "}
                  pieces
                </>
              )}
            </>
          ) : (
            <>Add what one pack holds — the PO Qty is worked out from it.</>
          )}
        </p>

        {/* A duplicate is refused by 0467's unique index on Save, so it is said
            here rather than discovered as a `23505` the screen cannot explain.
            Advisory text, NOT a cursor hold: the operator fixes it by changing
            the colour on either row, and caging them on one of the two would be
            picking which. */}
        {rows.filter(packRowStarted).length !== taken.size && (
          <p className="text-xs text-danger">
            Two members name the same garment in the same colour — give one a
            different colour, or put the count on a single row.
          </p>
        )}
      </div>
    </Sheet>
  );
}
