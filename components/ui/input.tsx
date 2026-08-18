import { forwardRef, type InputHTMLAttributes } from "react";
import { useRequiredHold } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Is this control empty, for the mandatory-field hold?
 *
 * `undefined` means UNCONTROLLED, and an uncontrolled input's emptiness is not
 * knowable from props — so it reads as "not empty" and never holds. Choosing the
 * miss over the false positive on purpose: a hold that fires on a field which is
 * actually filled is a cage, and every form in this app is controlled.
 */
export function holdEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() === "";
}

/**
 * Input types that must never hold, whatever `required` says.
 *
 * A tick box and a radio are not "empty", they are OFF — and `value` on one is
 * a submit token, not its state, so `holdEmpty` cannot read them anyway. More
 * to the point Enter on a tick box TOGGLES it (the keyboard contract), so a
 * hold there would refuse the key that fills the field: the same unsatisfiable
 * cage that Enter-on-a-picker was (client 2026-08-04). Buttons are not fields.
 */
const NEVER_HOLDS = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "range", "color"]);

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    /** Render + store CAPITALS as the user types (master Name fields — client
     *  2026-07-23). Mutates the value before onChange so the saved data is
     *  genuinely uppercase, AND applies `text-transform: uppercase` so values
     *  ALREADY stored in lower/mixed case (loaded from the DB, never re-typed)
     *  still DISPLAY in caps — the type-time transform alone can't fix those
     *  (client 2026-07-25). Placeholder stays normal-case so hints read cleanly. */
    uppercase?: boolean;
  }
>(({ className, uppercase, onChange, readOnly, tabIndex, ...props }, ref) => {
  /**
   * AN EMPTY DATE FIELD READS AS A PLACEHOLDER, NOT A VALUE (client, 2026-08-18:
   * "it should be so mild, not this much bold").
   *
   * `<input type="date">` draws its own `mm/dd/yyyy` prompt, and the browser
   * paints it in the ordinary text colour — so an untouched date sits in a row
   * of blank boxes looking like the only one already filled in. Every other
   * empty control here is muted; this makes the date agree with them.
   *
   * The `::-webkit-datetime-edit` pseudo-element is the only handle the page
   * has on that text. It is applied ONLY while the field is empty, so a real
   * date renders at full strength — muting a value the operator has entered
   * would be the opposite mistake.
   *
   * THIS IS COLOUR ONLY, AND IT IS NOT THE DD/MM/YYYY FIX. The ORDER of the
   * parts is the browser's locale and no attribute, rule or prop can change it
   * (doc/ui/LAYOUT.md §12). That needs a masked text input plus a calendar
   * popover — a component, not a style.
   */
  const mutedDate =
    props.type === "date" && (props.value === "" || props.value == null)
      ? "[&::-webkit-datetime-edit]:text-muted-foreground"
      : undefined;

  /**
   * MANDATORY AND BLANK HOLDS THE CURSOR (client 2026-08-04). Declared once, on
   * the enclosing `<Field required>` — the same prop that draws the `*` — so the
   * star and the hold cannot disagree. Never stamped on a readOnly/disabled
   * field: that is a cage with no keyboard way out, and a derived value
   * (the composed Material Name) fills itself once its sources are filled.
   */
  /**
   * NO SPINNERS ON A NUMBER FIELD (client 2026-08-17).
   *
   * Chrome and Safari draw a two-arrow stepper inside `<input type="number">`
   * and Firefox draws its own; on a dense ERP grid that stepper sits on top of
   * the value, and a mis-click nudges a quantity by one with nothing on screen
   * to say it happened. Removing it costs nothing — ↑/↓ inside a grid MOVE the
   * cursor (the keyboard contract), so the arrows were never the way a number
   * got typed here anyway.
   *
   * One place, because 325 `<Input type="number">` across 125 files is exactly
   * the fan-out AGENTS.md says never to answer per screen — and every number
   * field in the app goes through this primitive (zero raw
   * `<input type="number">` in the tree; `ValidatedInput` wraps this one), so
   * the ~22 hand-rolled grids inherit it without being edited.
   *
   * GATED ON `type === "number"`, never applied unconditionally: `appearance`
   * is what DRAWS a checkbox, a radio, a range and a colour swatch, so
   * `[appearance:textfield]` on those would erase the control itself. `Input`
   * carries no such type today, but `NEVER_HOLDS` above exists because one may
   * arrive.
   *
   * Both halves are needed: the webkit pseudo-elements are the Chrome/Safari
   * stepper, `appearance: textfield` on the input is Firefox's. `m-0` is for
   * the older Chrome that left the stepper's margin behind after hiding it.
   * Written before `className` in the merge, so a call site can still opt back
   * in.
   */
  const noSpinners =
    props.type === "number" &&
    "[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [appearance:textfield]";
  const hold = useRequiredHold(
    !readOnly &&
      !props.disabled &&
      !NEVER_HOLDS.has(props.type ?? "text") &&
      holdEmpty(props.value),
    {
    // A control's OWN `required` counts as a declaration too. The house
    // convention states it twice — `<Field required>` draws the star, `<Input
    // required>` sets the native attribute — but 102 controls carry it against
    // only 25 Fields, so reading just the wrapper would miss most of the fields
    // the app already calls mandatory. ORed, never overriding.
    required: props.required,
  });
  return (
  <input
    ref={ref}
    readOnly={readOnly}
    {...hold}
    /**
     * THE BROWSER'S MEMORY IS NOT A MASTER LIST.
     *
     * Chrome remembers every value ever typed into a field and re-offers that
     * list on focus — a plain white dropdown of whatever the last operator
     * happened to type on THIS machine. On an ERP that is wrong three ways
     * (client 2026-08-01):
     *
     *  - It looks authoritative and isn't. Beside a field whose real options
     *    come from a master table, a browser-remembered "RAAGAM TEXTILS" reads
     *    exactly like a stored row. Picking it writes a value no master has.
     *  - It leaks between operators. A shared shop-floor machine offers the
     *    previous user's customer names, salaries and party addresses to the
     *    next one.
     *  - It steals ↓. A field's list opens on ↓ (the `raagam-keyboard-contract`
     *    skill); while Chrome's popup is showing, Chrome eats ↓ to walk ITS
     *    suggestions instead. The contract breaks on exactly the fields that
     *    matter most.
     *
     * `data-picker.tsx` and `combobox.tsx` already set this by hand, which is
     * how we know it was hit before — but every plain Input was left uncovered.
     * Default it here so a field cannot forget.
     *
     * OPTING BACK IN is just passing `autoComplete` — the spread below wins, so
     * the login screen's `email` / `current-password` still reach the browser
     * and its password manager. That is the ONLY legitimate case: a field whose
     * value genuinely belongs to the person, not to the business.
     *
     * The `data-*` trio below is the same instruction to the password managers,
     * which ignore `autocomplete` and read only their own opt-outs. They go
     * undefined on an opted-in field for the reason just given — set them
     * unconditionally and the login form loses 1Password / LastPass fill.
     */
    autoComplete={props.autoComplete ?? "off"}
    data-1p-ignore={props.autoComplete ? undefined : ""}
    data-lpignore={props.autoComplete ? undefined : "true"}
    data-form-type={props.autoComplete ? undefined : "other"}
    /**
     * A FIELD THE OPERATOR CANNOT TYPE INTO IS NEVER A TAB STOP.
     *
     * `readOnly` inputs are natively focusable, so a derived field — an
     * auto-composed Name, an age from a date of birth, a country pulled from
     * the Notify party — sat in the middle of the typing path and had to be
     * tabbed past. The contract already said otherwise (`tabIndex={-1}` in
     * doc + the standing auto-field rule); it was just remembered by hand at
     * each call site, and forgotten on the one screen with the most derived
     * fields.
     *
     * This is the whole guarantee, not just for Tab: `FOCUSABLE_SELECTOR` in
     * lib/focus.ts excludes `[tabindex="-1"]` on every branch, so one attribute
     * also removes the field from the ↑↓←→ spatial walk, from Enter-advance and
     * from the Sheet focus trap. Nothing else needs to know.
     *
     * An explicit `tabIndex` still wins, so a caller can opt a read-only field
     * back into the order deliberately. Clicking still focuses it either way —
     * that is how a generated value stays hand-overridable.
     */
    tabIndex={tabIndex ?? (readOnly ? -1 : undefined)}
    className={cn(
      // text-base on mobile stops iOS zooming the viewport on focus; text-sm on
      // desktop keeps the dense ERP rhythm. Lives here rather than at ~595 call
      // sites that each re-typed `className="text-base md:text-sm"`.
      // `@2xl/editor:h-8` is the compact density height (doc/ui/LAYOUT.md).
      // Container query, not `md:`, so a control inside a ~440px nested picker
      // dialog — or on a phone — keeps the full 36px touch target. The editor
      // content wrappers in sheet.tsx / master-full-screen.tsx declare the
      // container. Keep this in step with select.tsx, combobox.tsx and
      // masters/picker-classes.ts or fields stop lining up.
      "h-9 @2xl/editor:h-8 w-full rounded-md border border-border bg-surface px-3 text-base md:text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      uppercase && "uppercase placeholder:normal-case",
      mutedDate,
      noSpinners,
      className,
    )}
    onChange={
      uppercase
        ? (e) => {
            // Preserve the caret — assigning .value moves it to the end.
            const { selectionStart, selectionEnd } = e.target;
            e.target.value = e.target.value.toUpperCase();
            try {
              e.target.setSelectionRange(selectionStart, selectionEnd);
            } catch {
              /* number/email inputs don't support selection ranges */
            }
            onChange?.(e);
          }
        : onChange
    }
    {...props}
  />
  );
});
Input.displayName = "Input";
