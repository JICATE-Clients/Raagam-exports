import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // Same rhythm as Input/Select: text-base on mobile stops iOS zooming the
      // viewport on focus, text-sm on desktop keeps the dense ERP density. This
      // was `text-sm` alone, so focusing a textarea zoomed the page while the
      // Input beside it did not.
      //
      // A textarea has no height to compact — it sizes off `rows` — so its share
      // of the `@2xl/editor:` scale is the vertical PADDING. A compact Input is
      // h-8 with a 20px line box and 2px of border, i.e. ~5px of effective
      // padding; at `py-2` the textarea's first line started 8px in, so its text
      // sat 3px below the field beside it and the two never shared a baseline.
      // Container query, not `md:`, for the same reason as input.tsx: a nested
      // ~440px picker dialog and every phone keep the roomier target.
      "w-full rounded-md border border-border bg-surface px-3 py-2 @2xl/editor:py-1.5 text-base md:text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
