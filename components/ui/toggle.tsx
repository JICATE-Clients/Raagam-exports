import { cn } from "@/lib/utils";

/**
 * A yes/no switch — the same answer a tick box gives, read at a glance.
 *
 * Built for the Garment Order header, where Pack and Mult. Ord are two of the
 * order's terms and an operator scans them rather than reads them (client
 * 2026-08-14). A 16px tick beside the word "Yes" makes the eye do two jobs: find
 * the box, then find the word that says which way it is set. A switch carries
 * its state in its shape and its colour, so the answer is legible from the
 * position alone.
 *
 * ## IT IS A REAL CHECKBOX UNDERNEATH, AND THAT IS A KEYBOARD RULE
 *
 * The obvious build is `<button role="switch">`, and it would silently break the
 * standing contract. Tab lands on FIELDS, and a field is `isFieldLike()`
 * (`lib/focus.ts`): a `<select>`, a `<textarea>`, a marked field trigger, or an
 * `<input>` whose type is not button/submit/reset/hidden/image. **A button is
 * none of those**, so a switch built as one would be skipped by Tab, by
 * Enter-advance and by the grid arrows — reachable only with the mouse, on an
 * app whose whole premise is that it does not need one.
 *
 * So the input stays, `sr-only` but focusable and in the document, and the
 * visible switch is drawn by its siblings. Everything the contract does keeps
 * working with no per-screen opt-in: Tab reaches it, Enter toggles it (the tick
 * box branch of the Enter ladder), Space toggles it natively, and a screen
 * reader announces a checkbox — which is what it is.
 *
 * `autoComplete` is not set: the autofill rule exempts checkboxes by
 * construction, since a tick box has no suggestion list for Chrome to offer.
 */
export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  id,
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * The words beside the switch — the THING, not its state.
   *
   * "Pack", never "Yes": the switch already says yes or no, and a static "Yes"
   * beside a control that may be off is the shape this component replaced.
   * Omit it where a `<Field>` label already names the answer.
   */
  label?: string;
  /**
   * The accessible name when there is no visible `label` AND no `<Field>` to
   * borrow one from — a switch in a CHILD GRID CELL, where the column header
   * names it on screen but reaches nothing programmatically.
   *
   * WITHOUT THIS, OMITTING `label` SHIPS AN UNNAMED CHECKBOX. The doc on `label`
   * says to omit it where a `<Field>` names the answer, which is true and was
   * the only case that existed — a grid cell is the case it does not cover, and
   * `ChildGrid`'s cards layout does not associate the header with the control
   * (`renderMobileRow` passes neither `htmlFor` nor the column's className). The
   * tick this replaced on the Material BOM item row carried a hand-written
   * `aria-label` for exactly that reason; the prop is that fix, kept.
   *
   * Say the QUESTION, not the column word: a header reading "Process" beside
   * twenty other cells is not what a screen reader user needs read out.
   */
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        // `min-h-9` so the switch centres against the 36px control height every
        // other field on the row uses — the same reason the tick boxes it
        // replaced carried it. Without this the row reads as ragged.
        "inline-flex min-h-9 w-fit cursor-pointer items-center gap-2 text-sm",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border border-border bg-surface-muted transition-colors",
          "peer-checked:border-primary peer-checked:bg-primary",
          // The focus ring lands on the TRACK because the input itself is
          // `sr-only` and has no box to draw one on. `focus-visible`, not
          // `focus`, so a mouse click does not leave a ring behind.
          "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1",
          // VARIANT ORDER MATTERS: `peer-checked:[&>span]:…` compiles to
          // `.peer:checked ~ .track > span`, which is the knob. Written the other
          // way round the peer relationship is resolved against the KNOB's own
          // siblings, where there is no peer at all, and the switch never moves.
          "peer-checked:[&>span]:translate-x-4",
        )}
      >
        <span className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform" />
      </span>
      {label && <span className="text-foreground">{label}</span>}
    </label>
  );
}
