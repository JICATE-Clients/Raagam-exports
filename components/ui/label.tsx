import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      // Compact density (`@2xl/editor:`, declared on the editor content wrapper
      // in sheet.tsx / master-full-screen.tsx) tightens the label's LINE BOX from
      // 16px to 14px and drops the 2px margin — 4px off every field on a desktop
      // editor. The 12px font size is deliberately unchanged: these are
      // muted-foreground labels and 11px would sit below a readable floor.
      // `leading-*` overriding the line-height baked into `text-xs` is exactly
      // what that utility is for, and outside the container query it simply does
      // not apply, so mobile keeps the roomier 16px box.
      "text-xs font-medium text-muted-foreground mb-0.5 block",
      "@2xl/editor:mb-0 @2xl/editor:leading-[14px]",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
