import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 *
 * With `blockedReason` set, that same key therefore now REPORTS THE REASON
 * rather than closing, because it is still activating Done and Done is what is
 * refusing. That is intended: Ctrl+S must not be a side door out of a rule the
 * button in front of the operator is enforcing.
 *
 * ## DONE CAN REFUSE — ESCAPE AND THE ✕ NEVER DO
 *
 * `blockedReason` (Quantities ▸ Assortments: the size/colour breakup must sum to
 * the destination's PO Qty) refuses to FINISH. It does not refuse to LEAVE, and
 * the asymmetry is deliberate rather than an oversight of the close paths.
 *
 * Escape and the ✕ run through `Sheet`'s `onClose` and never touch this footer,
 * so they stay live by construction — and they have to. A style that lists no
 * sizes has no breakup that can be made to match, so a rule enforced on every
 * exit would be UNSATISFIABLE: the operator could neither fix the number nor
 * leave the overlay, and the only way on would be the browser's Back button.
 * That is the shape AGENTS.md records under "A HOLD REFUSES MOVEMENT AND NEVER
 * REFUSES CHOOSING" — a refusal is only legitimate while some key still leads
 * out of it. Done-only leaves that key: Escape.
 */
export function SubSheetFooter({
  onDone,
  /** What the operator must save to keep this — named, because "the parent" is
   *  not a thing they can see from inside an overlay. */
  parent = "garment order",
  blockedReason,
  onBlocked,
}: {
  onDone: () => void;
  parent?: string;
  /** Why Done cannot finish here — null/undefined means it can. */
  blockedReason?: string | null;
  /** Called instead of `onDone` while blocked. The caller owns the message; it
   *  is already shown beside the button, so this is for the toast / the reveal. */
  onBlocked?: (reason: string) => void;
}) {
  const blocked = !!blockedReason;
  return (
    <>
      {/* `mr-auto` against the footer's `justify-end`, so the line sits left and
          the button stays where a primary action is expected.

          THE REASON REPLACES THE KEPT-CHANGES LINE, in place, rather than being
          added beside it. Proximity is the entire point: the 2026-08-20 finding
          on this exact overlay was that the arithmetic rule was never MISSING —
          it was stated in the grid's own totals, several inches from the caret
          and above the fold on a short window. A rule the operator has to go
          looking for is a rule they meet at Save. It belongs in the same glance
          as the button that is refusing, so it goes where that button's own
          status line already is. */}
      <span
        className={cn(
          "mr-auto text-xs",
          blocked ? "font-medium text-danger" : "text-muted-foreground",
        )}
      >
        {blocked ? blockedReason : `Changes here are kept — save the ${parent} to store them.`}
      </span>
      {/* BLOCKED WITH `aria-disabled`, NEVER `disabled` — the same treatment the
          Assort button carries in the orders screen (client 2026-08-17: "check
          why the assort button is not working"), and for the same two reasons:

          a truly `disabled` button stops firing pointer events, so anything it
          has to say — a `title`, a tooltip, a focus ring — never surfaces, and
          the operator is left with a greyed control and no reason. That is the
          failure AGENTS.md names under the nominated-vendor rule: empty-and-
          explain, never a silent refusal the operator has to guess at.

          And `disabled` would move the keyboard. `submitTargetOf` (lib/focus.ts)
          resolves a surface's primary action to the footer's last NON-disabled
          button, so a disabled Done would hand Ctrl+S to whatever sits before it
          — the 2026-07-25 bug where Ctrl+S resolved to Cancel. Enabled, the
          click, Ctrl+S and Enter all arrive here and all three report the same
          reason.

          The reason rides in `aria-label` as well as in the line to the left,
          because a screen reader moving button-to-button never reaches that
          line — it is a `<span>`, not a description of this control. */}
      <Button
        size="md"
        aria-disabled={blocked || undefined}
        aria-label={blocked ? `Done — ${blockedReason}` : undefined}
        className={cn(blocked && "cursor-not-allowed opacity-60")}
        onClick={() => {
          if (blocked) {
            onBlocked?.(blockedReason!);
            return;
          }
          onDone();
        }}
      >
        Done
      </Button>
    </>
  );
}
