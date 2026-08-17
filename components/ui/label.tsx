import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * THE LABEL ROW'S METRICS — its line box and the gap under it — as one string,
 * because something that is NOT a label sometimes has to sit level with one.
 *
 * Compact density (`@2xl/editor:`, declared on the editor content wrapper in
 * sheet.tsx / master-full-screen.tsx) tightens the LINE BOX from 16px to 14px and
 * drops the 2px margin — 4px off every field on a desktop editor. The 12px font
 * size is deliberately unchanged: these are muted-foreground labels and 11px
 * would sit below a readable floor. `leading-*` overriding the line-height baked
 * into `text-xs` is exactly what that utility is for, and outside the container
 * query it simply does not apply, so mobile keeps the roomier 16px box.
 *
 * IT IS EXPORTED BECAUSE THE ONE HAND-WRITTEN COPY OF IT DRIFTED. `ChildGrid`'s
 * `flushRows` header band is a column-header row pretending to be a label row, so
 * that the grid's first control lands level with the `Field` beside it —
 * doc/ui/LAYOUT.md §6 states it "gets `Label`'s exact metrics". It typed its own
 * `leading-[14px] mb-1.5` instead, and both halves were wrong under the container
 * query that matters: the 6px margin against this component's `mb-0`, and a
 * `leading` that never applied because it sat on the flex PARENT while each header
 * cell's own `text-xs` re-set the line-height. The band came out 22px against a
 * label's 14px, so Style ▸ Sizes drew its first size box 8px below the Description
 * textarea it shares a row with (client 2026-08-17, screenshot 2316).
 *
 * This is the same argument `field.tsx` makes for building its `label=""` spacer
 * out of the REAL `Label` rather than a hand-rolled div: "a hand-built spacer
 * would be a second copy of those numbers and would drift the first time they
 * changed." One consumer today; anything else pretending to be a label row must
 * use this rather than retype it.
 *
 * `leading-4` is a NO-OP for `Label` itself — `text-xs` already carries a 1rem
 * line-height — and is what makes the string self-sufficient for a consumer whose
 * own children re-set theirs (see `leading-[inherit]` in `child-grid.tsx`).
 */
export const LABEL_METRICS = "mb-0.5 leading-4 @2xl/editor:mb-0 @2xl/editor:leading-[14px]";

export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-xs font-medium text-muted-foreground block",
      LABEL_METRICS,
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
