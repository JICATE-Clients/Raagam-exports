import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

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
>(({ className, uppercase, onChange, readOnly, tabIndex, ...props }, ref) => (
  <input
    ref={ref}
    readOnly={readOnly}
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
));
Input.displayName = "Input";
