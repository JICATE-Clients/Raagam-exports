"use client";

/**
 * Style(s) ▸ Process — the modal behind the [Click] button on a style line.
 *
 * ## IT IS A WRAPPER NOW, AND THAT IS THE WHOLE FILE
 *
 * This was 430 lines: the Sheet, the four columns, the Type/Process cascade and
 * the `usedIds` scoping. All of that moved into `StyleProcessGrid`
 * (`style-process-grid.tsx`) on 2026-08-29 when the client asked for the list to
 * render inline as a fourth pane of the style row. The button and this sheet
 * were removed in the same change — and then restored the same day: "I think
 * the process button is lost, restore it with the function."
 *
 * **RESTORING IT COST ALMOST NOTHING BECAUSE THE REMOVAL EXTRACTED RATHER THAN
 * DELETED.** The grid was lifted out whole, so bringing the modal back is a
 * `Sheet` around a component that never stopped existing. That is the same
 * lesson the 2026-08-17 withdrawal of this feature recorded, one level up: a
 * withdrawal written properly is a withdrawal you can undo.
 *
 * ## THE GRID IS RENDERED IN TWO PLACES AND EDITS ONE LIST
 *
 * Here, and on the style row's own panel. That is not a second store: both are
 * handed the SAME `rows` and the same `onChange` out of `StyleRow.processes`, so
 * a process typed in the sheet is on the row behind it before the sheet closes.
 * There is no local draft here and no Apply button, for the reason the footer
 * states — the amendment's own Save is what persists them.
 *
 * A reader who thinks this is redundant is not wrong that it is two doors; it is
 * wrong to "fix" it by deleting one without asking, because the client asked for
 * each of them separately and a week apart.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { StyleProcessGrid } from "@/components/orders/style-process-grid";
import type {
  ComponentOption,
  ProcessOption,
  StyleProcessRow,
} from "@/lib/orders/amendments/style-processes";

export function StyleProcessSheet({
  open,
  onClose,
  styleLabel,
  rows,
  onChange,
  processes,
  components,
  newKey,
  readOnly = false,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  /** The style this list belongs to, for the sheet title. */
  styleLabel: string;
  rows: StyleProcessRow[];
  onChange: (next: StyleProcessRow[]) => void;
  processes: ProcessOption[];
  /** This style's own parts, already narrowed by the parent (0421). */
  components: ComponentOption[];
  newKey: () => string;
  readOnly?: boolean;
  /** The rect of the cell's button, so the box grows out of it. */
  origin?: SheetOrigin | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      /**
       * "md" — A CONTAINED BOX, AND THE NUMBER IS NOT A PREFERENCE.
       *
       * Client 2026-08-28: "restrict Style Process views to clean, smaller
       * containerized modals to prevent full-screen context loss."
       *
       * `sm` WAS TRIED FOR EXACTLY THIS AND WAS WRONG (client 2026-08-12,
       * screenshot 2266). `max-w-md` is 448px, less the branch's `px-5` leaves
       * ~408px, and `ChildGrid`'s responsive table only appears from `@lg`,
       * **which is 512px of container and not the 1024 the name suggests**. The
       * grid fell to stacked cards, which drops the column headers — Type,
       * Process and Details rendered as three unlabelled boxes. It missed by
       * ~104px, which is exactly why it looked like it should have worked.
       *
       * `md` is `max-w-6xl`: ~1112px of content against the ~840px the grid's
       * three declared widths and the `#`/remove chrome now need. That margin
       * grew on 2026-08-29 — the columns were re-budgeted from 12/16/12/20rem to
       * 7/8/7/flex when the grid had to fit a ~512px pane on the style row — so
       * the sheet is now comfortably oversized for its content rather than
       * tightly fitted to it. Do NOT narrow `size` to follow that: the same
       * grid also renders in a pane a third of this width, and it is the SHEET
       * that can afford to be generous.
       *
       * The lesson from 08-12 survives and is the reason this note is long: a
       * surface's size is a function of what is ON it, not of how it is opened.
       */
      size="md"
      /* CENTRED OVER THE CONTENT PANE, NOT THE VIEWPORT (client 2026-08-28:
         "just move it near to the style — now it looks unaligned; the centre
         modal stays"). The rail takes 192px off the left, so a viewport-centred
         box sits ~37px left of where the content starts and crosses the
         rail/content divider. */
      alignToPane
      /* Grows out of the Process cell that opened it. This is `Sheet`'s only
         caller for `origin` — its note there says so, and says why the prop is
         kept rather than deleted. */
      origin={origin}
      title={styleLabel ? `Process — ${styleLabel}` : "Process"}
      /* NO SAVE OF ITS OWN — the rows are part of the amendment and are written
         by the amendment's Save, so a Save here would imply they commit on their
         own, and on a NEW order there is no amendment id to commit them against.

         BUT NO FOOTER AT ALL READ AS BROKEN. The client reported this sheet as
         "missing save button" (2026-08-14): fields, a grid, an "+ Add process"
         button, then nothing but an ✕. `SubSheetFooter` says what actually
         happens rather than leaving it to be inferred. */
      zIndexBase={120}
      footer={<SubSheetFooter onDone={onClose} />}
    >
      <StyleProcessGrid
        rows={rows}
        onChange={onChange}
        processes={processes}
        components={components}
        newKey={newKey}
        readOnly={readOnly}
      />
    </Sheet>
  );
}
