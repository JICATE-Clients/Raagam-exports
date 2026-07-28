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
>(({ className, uppercase, onChange, ...props }, ref) => (
  <input
    ref={ref}
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
