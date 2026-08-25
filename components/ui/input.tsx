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

/**
 * THE TYPES THAT EXEMPT THEMSELVES FROM CAPITALS.
 *
 * `uppercase` is opt-OUT since 2026-08-18 (see `capsByDefault`), so this list is
 * what stops the flip reaching a value where case is meaning rather than style:
 *
 *   - `email` / `url` — a URL PATH is case-sensitive, so uppercasing one breaks
 *     the link. This is the exemption AGENTS.md already named.
 *   - `password` — self-evident, and it is a value that belongs to the person.
 *   - `search` — a query is not a stored value.
 *   - `number` / `date` / `time` / `datetime-local` / `month` / `week` — caps on
 *     digits is a no-op, but naming them keeps the rule legible and means a
 *     field that later grows letters (a `tel` extension, say) is already right.
 *   - the non-text controls — `appearance` is what DRAWS a checkbox, a radio, a
 *     range and a colour swatch; a text-transform on those is meaningless, and
 *     grouping them here matches `NEVER_HOLDS` above rather than inventing a
 *     second list of "not really a text box".
 *
 * A `type` NOT in this set is a text field, and a text field capitalises.
 */
const NO_CAPS_TYPES = new Set([
  "number", "date", "time", "datetime-local", "month", "week",
  "email", "url", "password", "search", "tel",
  "file", "checkbox", "radio", "button", "submit", "reset", "image", "range", "color", "hidden",
]);

/**
 * CAPITALS ARE THE DEFAULT, AND THIS IS WHERE THAT WAS DECIDED (client
 * 2026-08-18, screenshot 2348: "update only as capital letter, now it's typing
 * small letter only, make it like how masterdata module").
 *
 * The CAPITALS rule (AGENTS.md) is as old as the masters and was never in
 * doubt. What was wrong is that its screen half was OPT-IN PER CALL SITE, so it
 * got applied in `components/masters/` and almost nowhere else: 873 of 968
 * `<Input>` under `app/(app)` carried no `uppercase`. The proof that a per-call
 * -site rule cannot hold is inside a single file — `amendment-screen.tsx` had
 * `uppercase` on Pack Description and not on Styles Details ▸ Description, one
 * file with two answers and nothing deciding which. That is the fan-out AGENTS.md
 * says never to answer per screen, so the default moved here instead.
 *
 * WHAT THIS BUYS beyond the 873: the ~22 hand-rolled grids inherit it without
 * being edited, and a screen written next month is correct without knowing the
 * rule exists. What it COSTS is that the risk inverts — a field that
 * deliberately never opted in now changes silently — which is why the type list
 * above exists and why the four genuinely case-sensitive call sites
 * (a website, an email typed as text, two hand-typed uuids) pass
 * `uppercase={false}` with a `caps-input: exempt` comment beside them.
 *
 * `readOnly` EXEMPTS ITSELF, and this is not a detail: a read-only box holds a
 * value the operator did not type — a composed Material Name, an age derived
 * from a date of birth, a fetched party address — so capitalising it would
 * misreport what is stored rather than change what is entered. AGENTS.md's
 * exemption for derived `(auto)` fields is exactly this case.
 *
 * `ValidatedInput` is untouched by the flip BY CONSTRUCTION: it always passes an
 * explicit `uppercase={spec?.transform === "upper"}`, and an explicit value beats
 * a default. That is what keeps every `format="email"` / `format="website"`
 * master field safe without one line of opt-out — and it is also why turning one
 * of those into capitals means editing its FORMAT SPEC, not its call site.
 */
function capsByDefault(type: string | undefined, readOnly: boolean | undefined) {
  return !readOnly && !NO_CAPS_TYPES.has(type ?? "text");
}

/**
 * THE LAST DAY A DATE FIELD WILL ACCEPT — and the only thing that stops the
 * year segment taking six digits (client 2026-08-21, screenshot 2438:
 * Deli.Dt reading `dd-mm-142343`).
 *
 * `<input type="date">` DOES NOT CAP ITS YEAR AT FOUR DIGITS. Chrome's year
 * segment accepts up to six (the HTML date format allows years past 9999), and
 * `maxLength` does nothing on a date input — it applies to text-entry types
 * only. So there is no attribute, no CSS and no keystroke handler on the page
 * that limits it; the segment is browser chrome, and the page cannot even read
 * which part of it has the caret.
 *
 * `max` IS THE ONE THING THAT WORKS, and it works by the DIGIT COUNT of its own
 * year. Measured in Chrome 2026-08-21, typing `21082026666` into each:
 *
 *     plain                      -> "26666-08-21"   checkValidity() TRUE
 *     min="1000-01-01" only      -> "26666-08-21"   checkValidity() TRUE
 *     max="9999-12-31"           -> "6666-08-21"    capped at 4 digits
 *
 * Two things in that table are worth keeping. `min` DOES NOT HELP — it bounds
 * validity, not typing, so a lower bound alone leaves the bug exactly as it
 * was. And the plain field reports itself VALID at year 26666: the browser has
 * no opinion, `checkValidity()` is true, and nothing downstream would have
 * flagged it either. That is why this is a silent data bug rather than a
 * visible one — a `date` column will happily store year 26666.
 *
 * Set BEFORE the `{...props}` spread, so a call site that has a real ceiling
 * ("not after today", "within the order's season") still wins. Any override it
 * passes is itself a 4-digit year, so the cap survives being narrowed.
 *
 * 9999 rather than a plausible business year: this is a TYPO GUARD, not a
 * calendar. Deciding that an order cannot be delivered after 2100 is a business
 * rule, and it belongs on the field that has that rule, not on every date box
 * in the app.
 */
export const DATE_MAX = "9999-12-31";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    /** Render + store CAPITALS as the user types (master Name fields — client
     *  2026-07-23). Mutates the value before onChange so the saved data is
     *  genuinely uppercase, AND applies `text-transform: uppercase` so values
     *  ALREADY stored in lower/mixed case (loaded from the DB, never re-typed)
     *  still DISPLAY in caps — the type-time transform alone can't fix those
     *  (client 2026-07-25). Placeholder stays normal-case so hints read cleanly.
     *
     *  ON BY DEFAULT SINCE 2026-08-18 — pass `uppercase={false}` to opt OUT.
     *  See `capsByDefault` below for why the default flipped and what exempts
     *  itself without being asked. */
    uppercase?: boolean;
  }
>(({ className, uppercase, onChange, readOnly, tabIndex, ...props }, ref) => {
  /** Opt-out, not opt-in: an explicit prop always wins. See `capsByDefault`. */
  const caps = uppercase ?? capsByDefault(props.type, readOnly);
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

  /**
   * ↑/↓ MOVE THE CURSOR. THEY DO NOT STEP THE VALUE (client 2026-08-25: "I can't
   * type the number, it's only updating using the arrow with point numbers
   * only", screenshot 2486 — a BOM Items cell reading 0.059).
   *
   * ## THE SPINNER BLOCK ABOVE FIXED THE MOUSE AND LEFT THE KEYBOARD
   *
   * It hides Chrome's, Safari's and Firefox's steppers, and its own comment
   * says "removing it costs nothing — ↑/↓ inside a grid MOVE the cursor, so the
   * arrows were never the way a number got typed here anyway". The first half is
   * true and the second is the assumption that was wrong: `appearance` is CSS
   * and the browser's keyboard stepping is not. So the stepper became invisible
   * and kept working.
   *
   * What that costs is worse than the mis-click it replaced. `gridKeyNav` moves
   * the caret down a column on ↓ — the documented way to walk a grid — and the
   * browser ALSO stepped the cell being left, by `step` (0.001 on a consumption
   * figure). Every pass through a numeric column nudged it, silently, with the
   * screen showing a plausible number the whole way. 0.059 is fifty-nine
   * keystrokes of navigation, not a typed figure, and it is the quantity a
   * purchase order is written from.
   *
   * ## `preventDefault` ONLY, NEVER `stopPropagation`
   *
   * The default action is the step; the event still has to reach `gridKeyNav`
   * on the grid body and `lib/focus.ts` above it, or this would fix a nudged
   * value by breaking movement altogether — trading a wrong number for a cage.
   * That distinction is the whole fix.
   *
   * ONE PLACE, for the reason the spinner block gives: 325 `<Input
   * type="number">` across 125 files, zero raw `<input type="number">` in the
   * tree, and `ValidatedInput` wraps this one — so the ~22 hand-rolled grids are
   * covered without being edited. AGENTS.md is explicit that a keyboard
   * complaint is never answered per screen.
   *
   * ALT IS LEFT ALONE, matching `gridKeyNav`, which returns early on `altKey`
   * so Alt+↓ can reach `arrowOpensPicker`. A modifier chord belongs to the layer
   * above this one.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      props.type === "number" &&
      !e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
    }
    props.onKeyDown?.(e);
  };
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
    /** Four-digit years. See `DATE_MAX` — this is the whole fix, and it has to
     *  sit above the spread so a call site's own ceiling still wins. */
    max={props.type === "date" ? props.max ?? DATE_MAX : props.max}
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
      caps && "uppercase placeholder:normal-case",
      mutedDate,
      noSpinners,
      className,
    )}
    onChange={
      caps
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
    /* AFTER the spread, deliberately. `onKeyDown` wraps and then CALLS
       `props.onKeyDown`, so a call site's handler still runs — but if the spread
       came last it would replace this one outright and the field would silently
       start stepping again. The guard being un-overridable is the point: the
       spinner block above is set before the spread precisely so a call site CAN
       opt back in, and this is the opposite case. */
    onKeyDown={onKeyDown}
  />
  );
});
Input.displayName = "Input";
