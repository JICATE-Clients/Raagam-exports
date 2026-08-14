import { Button } from "@/components/ui/button";

/**
 * The footer for an overlay that has NO SAVE OF ITS OWN.
 *
 * The Garment Order opens three of these — Style ▸ Process, Combos ▸ Structure
 * Details, Quantities ▸ Assortments. Each edits rows that live in the order's
 * state and are written by the order's Save, so none of them saves anything and
 * all three shipped with no footer at all.
 *
 * THAT WAS CORRECT AND IT READ AS BROKEN. The client reported the Process sheet
 * as "missing save button" (2026-08-14, screenshot 2288): a form with fields, a
 * grid, an "+ Add process" button and then nothing but an ✕. Reading that as
 * unfinished is the reasonable inference, and an operator who draws it will
 * either retype the work or avoid the screen.
 *
 * So the footer says what happens instead of leaving it to be guessed. It
 * deliberately does NOT add a Save: there is nothing here to save. On a NEW
 * garment order the amendment has no id yet, so a save on this overlay could not
 * even address a row — and a second Save inside a screen that already has one
 * puts the operator's work somewhere the unsaved-changes guard is not looking,
 * which is the reason these overlays were built without one.
 *
 * ## Ctrl+S CLOSES THESE, and that is the honest answer
 *
 * `Sheet` registers the Save shortcut on `open && !!footer && size !== "sm"`, so
 * giving these a footer opts them in, and the shortcut activates the LAST footer
 * button — Done. There is no save to reach for on this layer, so "finish here
 * and go back to the order, where Ctrl+S does save" is what the key can honestly
 * mean. It is the same one-layer-at-a-time shape Escape already has.
 */
export function SubSheetFooter({
  onDone,
  /** What the operator must save to keep this — named, because "the parent" is
   *  not a thing they can see from inside an overlay. */
  parent = "garment order",
}: {
  onDone: () => void;
  parent?: string;
}) {
  return (
    <>
      {/* `mr-auto` against the footer's `justify-end`, so the line sits left and
          the button stays where a primary action is expected. */}
      <span className="mr-auto text-xs text-muted-foreground">
        Changes here are kept — save the {parent} to store them.
      </span>
      <Button size="md" onClick={onDone}>
        Done
      </Button>
    </>
  );
}
