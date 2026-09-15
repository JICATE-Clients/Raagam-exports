import { cn } from "@/lib/utils";

/**
 * A two-or-three way choice with EVERY OPTION NAMED on screen.
 *
 * Built for the Assortments overlay, where the client asked for Single Style
 * and Multiple Style as a toggle rather than a tick box (screenshot 2356,
 * 2026-08-19), and the legacy screen it replaces shows both words side by side.
 *
 * ## WHY THIS IS NOT `Toggle`
 *
 * A `Toggle` names ONE thing and lets its position say yes or no. That is right
 * for "Pack" or "Mult. Ord", where the off state is the absence of the thing.
 * It is wrong here: Single Style is not the absence of Multiple Style, it is the
 * other of two packing arrangements, and a switch labelled "Multiple styles"
 * asks the operator to work out what the off position means. Where both states
 * have names the operator uses, both names belong on screen.
 *
 * ## IT IS A REAL RADIO GROUP UNDERNEATH, AND THAT IS A KEYBOARD RULE
 *
 * The same rule `Toggle` records, one control along. Tab lands on FIELDS, and a
 * field is `isFieldLike()` (`lib/focus.ts`) — a `<select>`, a `<textarea>`, a
 * marked field trigger, or an `<input>` whose type is not
 * button/submit/reset/hidden/image. A `<button role="radio">` is none of those,
 * so a segmented control built from buttons is invisible to Tab, to
 * Enter-advance and to the grid arrows.
 *
 * Real radios need NO new keyboard code at all, and three separate rules in
 * `lib/focus.ts` already account for them:
 *
 * - `isFieldLike` accepts them, so Tab lands here;
 * - `ownsArrowKeys` names `radio` explicitly, so ↑/↓ move WITHIN the group
 *   natively instead of being stolen by the grid or the spatial arrows — and in
 *   a radio group moving the selection IS selecting, so no Enter branch is
 *   needed either;
 * - `enterAdvances`' tick-box branch covers `checkbox|radio` together, and its
 *   comment already reasons about a trailing radio being "reached already
 *   checked".
 *
 * `child-grid.tsx`'s `ROW_FIELDS` is deliberately this list MINUS radio, for the
 * same reason: a grid must not steal ↑/↓ from a radio group. So a Segmented
 * placed inside a grid row keeps its native arrows and the grid keeps its own.
 *
 * ## ONE `name` PER GROUP, AND IT MUST BE UNIQUE ON THE PAGE
 *
 * Radios group by `name`, across the whole document rather than the component.
 * Two Segmenteds sharing a name become ONE group: picking in the second clears
 * the first, silently. Where a Segmented is rendered per record — one per grid
 * row, one per overlay — the record's own key belongs in the name.
 *
 * `autoComplete` is not set: the autofill rule exempts radios by construction,
 * since a radio has no suggestion list for Chrome to offer.
 */
export function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: {
  /** Unique per group ON THE PAGE — see the note above. */
  name: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      // `role` is left to the native radios. An explicit `radiogroup` on the
      // wrapper would be correct markup and is redundant here — the inputs
      // already announce as a group through their shared `name`, and adding the
      // role without also managing `aria-checked` and roving focus by hand is
      // how a control ends up describing itself twice.
      className={cn(
        /**
         * THE SAME HEIGHT AS THE FIELD BESIDE IT, IN BOTH DENSITIES
         * (client 2026-08-19: "that ratio button size is a little bit different
         * from the single/multiple button height — make it even").
         *
         * `Input`, `Select` and every other control are `h-9 @2xl/editor:h-8`:
         * 36px normally, compacting to 32px inside a desktop editor. This
         * carried the 36px half only, so on any editor surface — which is
         * exactly where it is used — it stood 4px taller than the `Select` next
         * to it and the row read as uneven.
         *
         * Both halves, or the control is right in one density and wrong in the
         * other. `min-h-8` still clears its own content: `py-1` + a 20px
         * text-sm line box + `p-0.5` is 32px on the nose.
         *
         * `Toggle` carries the same 36px-only assumption and the same latent
         * 4px gap; its track is a 20px pill centred in the slot, so it shifts
         * 2px rather than changing the row's height, and nobody has reported it.
         */
        /**
         * A GREY TRACK WITH A WHITE PILL RIDING IN IT — the shape `taSegNav`
         * (garment-order-screen.tsx) has always used for Activity/Approval,
         * and now the one this primitive uses too, so the two segmented
         * controls that sit inches apart on the T&A tab are one control in two
         * places rather than two that merely rhyme.
         *
         * THIS REVERSES THE 2026-09-11 TINTED PILL, DELIBERATELY. That day's
         * answer to "make active tab more attractive now look not clean" was a
         * `bg-primary-soft` pill on a white track — louder, but it read as a
         * THIRD selected-state treatment beside the Activity/Approval pills
         * above it. The selected segment is still the loud one; it is simply
         * lifted out of the track by contrast and a shadow, the way the tabs
         * beside it are, instead of by a tint of its own.
         */
        "inline-flex min-h-9 @2xl/editor:min-h-8 w-fit items-center rounded-md border border-border bg-surface-muted p-0.5",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((o) => {
        const off = disabled || o.disabled;
        return (
          <label
            key={o.value}
            className={cn(
              "relative inline-flex cursor-pointer items-center rounded px-3 py-1 text-sm transition-colors",
              off && "cursor-not-allowed",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              className="peer sr-only"
              checked={value === o.value}
              disabled={off}
              onChange={() => onChange(o.value)}
            />
            {/* The pill, and the focus ring, BEFORE the text in DOM order.
                Both are positioned elements with an auto z-index, so paint
                order is DOM order and the label below lands on top — a `-z-10`
                here would instead push the pill behind the WRAPPER's own
                `bg-surface` and make the selection invisible.
                The ring lands on this overlay because the input is `sr-only`
                and has no box of its own to draw one on — `Toggle`'s track
                plays the same part. `focus-visible`, not `focus`, so a mouse
                click does not leave a ring behind.

                WHITE ON GREY, AND THE TEXT KEEPS ITS COLOUR (operator,
                2026-09-12: one segmented style for the main tabs and the PP
                approval tabs both). `bg-surface` + `shadow-sm` under
                `text-primary` is exactly what `taSegNav`'s active pill does,
                so the two controls now differ in nothing but their content.
                The 2026-09-11 note this replaces asked for a louder selected
                state and got a tinted pill; the lift is what was wanted, and
                a white pill on the grey track gives more of it than a tint on
                a white track did — see the wrapper's own comment. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 rounded transition-colors",
                "peer-checked:bg-surface peer-checked:shadow-sm",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40",
              )}
            />
            <span
              className={cn(
                "relative rounded text-muted-foreground transition-colors",
                // The selected segment. `peer-checked` rather than a className
                // built from `value === o.value` so the whole control is one
                // static string Tailwind's source scan can see.
                "peer-checked:font-semibold peer-checked:text-primary",
              )}
            >
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
