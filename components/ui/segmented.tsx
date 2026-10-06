import type { ComponentType, ReactNode } from "react";
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
      //
      // THE SAME HEIGHT AS THE FIELD BESIDE IT, IN BOTH DENSITIES (client
      // 2026-08-19) — `SEG_TRACK` carries `h-9 @2xl/editor:h-8`, the pair every
      // Input and Select uses.
      //
      // THE SAME SHAPE AS `ToggleGroup` (2026-10-06, see SEG_TRACK). This was a
      // grey track with a white pill — the T&A switcher's shape — and that is
      // one of the looks the one-shape rule retired: the lit word is now the
      // solid primary segment the queue box has always had, so a radio group
      // and a view switch on one screen are one control in two places.
      data-segmented=""
      className={cn(SEG_TRACK, "text-sm", disabled && "opacity-60", className)}
    >
      {options.map((o) => {
        const off = disabled || o.disabled;
        return (
          <label
            key={o.value}
            className={cn(
              "relative inline-flex h-full cursor-pointer items-center px-3",
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
            {/* The lit fill, and the focus ring, BEFORE the text in DOM order.
                Both are positioned elements with an auto z-index, so paint
                order is DOM order and the label below lands on top — a `-z-10`
                here would instead push the fill behind the WRAPPER's own
                `bg-surface` and make the selection invisible.
                The ring lands on this overlay because the input is `sr-only`
                and has no box of its own to draw one on. `focus-visible`, not
                `focus`, so a mouse click does not leave a ring behind.
                No `data-seg-pill`: that appearance hook paints a white gloss
                made for a WHITE pill, and on a solid one it bleached the top
                half (the "half white" bom-queue.tsx records, 2026-10-03). */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 rounded-control-inner transition-colors",
                "peer-checked:bg-(--primary) peer-checked:shadow-sm",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              )}
            />
            <span
              className={cn(
                "relative text-muted-foreground transition-colors",
                // `peer-checked` rather than a className built from
                // `value === o.value` so the whole control is one static
                // string Tailwind's source scan can see.
                "peer-checked:font-semibold peer-checked:text-primary-foreground",
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

/*
 * ONE SHAPE FOR EVERY "PICK ONE OF THESE WORDS" CONTROL (user 2026-10-06:
 * "this is the button shape i prefer for the whole application" — the
 * Pending / Updated / Draft box on the BOM and Budget queues). Before this the
 * app drew the same job seven ways: a 24px track with 4px corners on Profit
 * Check, a 28px one on Progress, square segments on the Trims board, full
 * pills on HR ▸ Person and the T&A switcher, a grey track with a white pill on
 * `Segmented`. They are now `SEG_TRACK` + `SEG_ITEM` and nothing else.
 *
 * - The track: 36px (32px inside a dense editor, like every field), a 1px
 *   border, `rounded-control` — the fixed 8px radius every Button takes too.
 * - A segment: the track's height less its 2px padding, nested at
 *   `rounded-control-inner`, icon + word + optional count.
 * - The lit segment wears the PRIMARY BUTTON'S OWN MARKERS (`ty-btn-solid
 *   ty-btn-primary`), so it follows every colour preset, gradient or flat,
 *   exactly as the queue box has since 2026-09-22 — `bg-(--primary)` rather
 *   than `bg-primary`, because the raagam skin repaints any
 *   `button[class*="bg-primary"]` a fixed light blue (see bom-queue.tsx).
 *
 * `data-segmented` is the appearance hook (lib/appearance.ts STYLES) that gives
 * the track its recessed look under a surface style.
 *
 * Gated by `npm run check:button-shape`: an `aria-pressed` button hand-rolled
 * outside components/ui is refused, so an eighth shape cannot arrive.
 */
export const SEG_TRACK =
  "inline-flex h-9 @2xl/editor:h-8 w-fit max-w-full shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-none rounded-control border border-border bg-surface p-0.5 text-xs font-medium";
export const SEG_ITEM =
  "inline-flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control-inner px-2.5 transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
export const SEG_LIT =
  "ty-btn-solid ty-btn-primary bg-(--primary) hover:bg-(--primary-hover) font-semibold text-primary-foreground shadow-sm";
export const SEG_IDLE = "text-muted-foreground hover:bg-surface-muted hover:text-foreground";

export type ToggleOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** A lucide icon, drawn at 14px before the word. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Shown after the word as `(n)`. Zero is drawn: zero is information. */
  count?: number;
  /** Anything else after the word — a coloured count chip, a dot. */
  after?: ReactNode;
  disabled?: boolean;
  title?: string;
};

/**
 * A row of buttons, ONE lit — the shape for a VIEW or FILTER switch on a list,
 * board or report (Pending / Updated / Draft, Value / % / Per pc, Orders /
 * Overview). Buttons with `aria-pressed`, not radios: a view switch is not a
 * field of the record, so it stays off the Tab-lands-on-fields path the same
 * way the "Filters" button does. Where the choice IS a value being entered on a
 * form, use `Segmented` above — same look, real radios underneath.
 *
 * `onChange` receives the clicked word even when it is already lit; a caller
 * that cycles (the queue box steps to the next word) or clears decides that.
 * `value: null` lights nothing.
 */
export function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  role = "group",
  className,
}: {
  value: T | null;
  onChange: (next: T) => void;
  options: ToggleOption<T>[];
  /** Read to a screen reader as the group's name ("Status", "View"). */
  label: string;
  /** `tablist` when the words switch whole panels, as a tab row would. */
  role?: "group" | "tablist";
  className?: string;
}) {
  const tabs = role === "tablist";
  return (
    <div role={role} aria-label={label} data-segmented="" className={cn(SEG_TRACK, className)}>
      {options.map((o) => {
        const lit = value === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? lit : undefined}
            aria-pressed={tabs ? undefined : lit}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(SEG_ITEM, lit ? SEG_LIT : SEG_IDLE)}
          >
            {Icon && <Icon aria-hidden />}
            {o.label}
            {o.count != null && <span className="tabular-nums opacity-80">({o.count})</span>}
            {o.after}
          </button>
        );
      })}
    </div>
  );
}
