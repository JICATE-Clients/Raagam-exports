import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    /** Render + store CAPITALS as the user types (master Name fields — client
     *  2026-07-23). Mutates the value before onChange so the saved data is
     *  genuinely uppercase, not just styled. */
    uppercase?: boolean;
  }
>(({ className, uppercase, onChange, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
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
