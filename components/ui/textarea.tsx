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
      "w-full rounded-md border border-border bg-surface px-3 py-2 text-base md:text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
