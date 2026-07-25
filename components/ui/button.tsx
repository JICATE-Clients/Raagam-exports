import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm",
  outline:
    "border border-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  danger: "bg-danger text-white hover:opacity-90 shadow-sm",
  subtle: "bg-surface-muted text-foreground hover:bg-border",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-md gap-1.5",
  md: "h-9 px-4 text-sm rounded-md gap-2",
  lg: "h-11 px-6 text-sm rounded-lg gap-2",
  icon: "h-9 w-9 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors",
        // Icons inside a button are sized and pinned by the button, never by
        // whatever the caller passed — an unconstrained svg stretches to fill
        // and reads as a distorted icon (client 2026-07-24 #6).
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        // Focus: a plain 2px ring, no offset. `ring-offset-1` was leaving a 1px
        // gap in Tailwind's default offset colour — WHITE — so a focused button
        // read as 1px white + 2px indigo while a focused Input read as a solid
        // 2px indigo. Correct-looking on a white card, wrong on any tinted
        // surface, and broken outright once dark mode is wired (client
        // 2026-07-25). Matches input.tsx / select.tsx / combobox.tsx exactly.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
